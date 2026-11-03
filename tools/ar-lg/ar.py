"""Ar-condicionado LG (ThinQ) na barra de menu do Mac, pela API oficial LG ThinQ Connect.

Token pessoal: https://connect-pat.lgthinq.com → guardar no Keychain:
    security add-generic-password -a ar-lg -s ar-lg -w '<TOKEN>'
Rodar: .venv/bin/python ar.py
"""
import asyncio
import subprocess
import uuid

import aiohttp
import rumps
from thinqconnect import AirConditionerDevice, ThinQApi
from thinqconnect.devices.const import Property as P

MODES = {"Frio": "COOL", "Seco": "AIR_DRY", "Ventilar": "FAN", "Auto": "AUTO"}
FANS = {"Baixa": "LOW", "Média": "MID", "Alta": "HIGH", "Auto": "AUTO"}


def keychain(service, default=None):
    r = subprocess.run(["security", "find-generic-password", "-s", service, "-w"], capture_output=True, text=True)
    if r.returncode == 0:
        return r.stdout.strip()
    if default is None:
        raise SystemExit(f"Falta '{service}' no Keychain (ver o topo do ar.py)")
    subprocess.run(["security", "add-generic-password", "-a", "ar-lg", "-s", service, "-w", default], check=True)
    return default


TOKEN = keychain("ar-lg")
CLIENT_ID = keychain("ar-lg-client", f"ar-lg-{uuid.uuid4()}")
_cache = {}  # deviceInfo e profile não mudam: busca uma vez


async def _run(action):
    async with aiohttp.ClientSession() as s:
        api = ThinQApi(session=s, access_token=TOKEN, country_code="BR", client_id=CLIENT_ID)
        if not _cache:
            dev = next(d for d in await api.async_get_device_list()
                       if d["deviceInfo"]["deviceType"] == "DEVICE_AIR_CONDITIONER")
            _cache.update(dev=dev, profile=await api.async_get_device_profile(dev["deviceId"]))
        dev, info = _cache["dev"], _cache["dev"]["deviceInfo"]
        ac = AirConditionerDevice(
            thinq_api=api, device_id=dev["deviceId"], device_type=info["deviceType"],
            model_name=info.get("modelName", ""), alias=info.get("alias", "Ar"),
            reportable=info.get("reportable", False), group_id=info.get("groupId", ""),
            profile=_cache["profile"],
        )
        ac.set_status(await api.async_get_device_status(ac.device_id))
        if action:
            await action(ac)
            await asyncio.sleep(1.5)  # o estado na nuvem demora um pouco a refletir o comando
            ac.set_status(await api.async_get_device_status(ac.device_id))
        return ac


async def set_temp(ac, t):
    try:
        await ac._set_target_temperature(t, "C")
    except ValueError:  # modelos que só expõem a temperatura do modo frio
        await ac.set_cool_target_temperature_c(t)


class App(rumps.App):
    def __init__(self):
        super().__init__("Ar", quit_button="Sair")
        self.menu = [
            rumps.MenuItem("Ligar/Desligar", callback=lambda _: self.do(self.toggle)),
            None,
            rumps.MenuItem("+1 °C", callback=lambda _: self.do(lambda ac: set_temp(ac, self.target + 1))),
            rumps.MenuItem("−1 °C", callback=lambda _: self.do(lambda ac: set_temp(ac, self.target - 1))),
            None,
            ("Modo", [rumps.MenuItem(k, callback=lambda i: self.do(lambda ac: ac.set_current_job_mode(MODES[i.title])))
                      for k in MODES]),
            ("Ventilação", [rumps.MenuItem(k, callback=lambda i: self.do(lambda ac: ac.set_wind_strength(FANS[i.title])))
                            for k in FANS]),
            None,
            rumps.MenuItem("Atualizar", callback=lambda _: self.do(None)),
        ]
        self.target = 23
        rumps.Timer(lambda _: self.do(None, quiet=True), 60).start()

    @staticmethod
    async def toggle(ac):
        on = ac.get_status(P.AIR_CON_OPERATION_MODE) == "POWER_ON"
        await ac.set_air_con_operation_mode("POWER_OFF" if on else "POWER_ON")

    def do(self, action, quiet=False):
        try:
            ac = asyncio.run(_run(action))
        except Exception as e:
            self.title = "Ar ?"
            if not quiet:
                rumps.notification("Ar LG", "Falhou", str(e)[:200])
            return
        self.target = ac.get_status(P.TARGET_TEMPERATURE_C) or ac.get_status(P.COOL_TARGET_TEMPERATURE_C) or self.target
        if ac.get_status(P.AIR_CON_OPERATION_MODE) != "POWER_ON":
            self.title = "Ar desl."
            return
        now = ac.get_status(P.CURRENT_TEMPERATURE_C)
        mode = next((k for k, v in MODES.items() if v == ac.get_status(P.CURRENT_JOB_MODE)), "")
        self.title = f"{now:.0f}° → {self.target:.0f}° {mode}" if now is not None else f"→ {self.target:.0f}° {mode}"


if __name__ == "__main__":
    App().run()
