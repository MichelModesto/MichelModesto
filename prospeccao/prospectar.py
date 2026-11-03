"""Prospecção de comércios SEM site via Google Places API (New).

Uso:
  python3 prospectar.py "pet shop" "São Paulo SP" [max_chamadas=900]
  python3 prospectar.py "pizzaria,sushi,hamburgueria" "São Paulo SP" 200   (teto vale por nicho)

A API devolve no máximo 60 por busca, então a cidade é fatiada em quadrados; quadrado que
enche (60) é dividido em 4 de novo. Só entra quem não tem site (ou só tem rede social).
Saída: saida/<nicho>-<cidade>-<data>.csv. leads.db guarda só place_id + status.
Termos do Google: dados do Places valem 30 dias -> apague os CSV antigos.
"""
import csv, datetime, json, re, sqlite3, sys, time, urllib.error, urllib.request
from pathlib import Path

DIR = Path(__file__).parent
CAMPOS = "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.primaryTypeDisplayName,places.googleMapsUri,places.businessStatus,nextPageToken"
REDES = ("instagram.com", "facebook.com", "linktr.ee", "wa.me", "whatsapp.com", "ifood.com.br")


def chave():
    for linha in (DIR / ".env").read_text().splitlines():
        if linha.startswith("GOOGLE_PLACES_KEY="):
            return linha.split("=", 1)[1].strip()
    sys.exit("Falta GOOGLE_PLACES_KEY em prospeccao/.env")


class TetoAtingido(Exception):
    pass


class Places:
    def __init__(self, key, max_chamadas):
        self.key, self.restam = key, max_chamadas

    def post(self, corpo, campos):
        if self.restam <= 0:
            raise TetoAtingido
        self.restam -= 1
        req = urllib.request.Request(
            "https://places.googleapis.com/v1/places:searchText", data=json.dumps(corpo).encode(),
            headers={"Content-Type": "application/json", "X-Goog-Api-Key": self.key, "X-Goog-FieldMask": campos})
        for espera in (5, 20, 60, 0):
            try:
                return json.load(urllib.request.urlopen(req, timeout=30))
            except urllib.error.HTTPError as erro:
                corpo = erro.read()
                if erro.code != 429 or not espera or b"per day" in corpo:  # cota diária: esperar não adianta
                    print(f"\nGoogle respondeu {erro.code}: {corpo[:300]!r}")
                    raise TetoAtingido
                print(f"  429 (muitas chamadas), esperando {espera}s...")
                time.sleep(espera)

    def area_da_cidade(self, cidade):
        v = self.post({"textQuery": cidade}, "places.viewport")["places"][0]["viewport"]
        return v["low"]["latitude"], v["low"]["longitude"], v["high"]["latitude"], v["high"]["longitude"]

    def buscar(self, texto, ret):
        """Até 60 lugares dentro do retângulo (s, w, n, e)."""
        s, w, n, e = ret
        corpo = {"textQuery": texto, "languageCode": "pt-BR", "pageSize": 20,
                 "locationRestriction": {"rectangle": {"low": {"latitude": s, "longitude": w}, "high": {"latitude": n, "longitude": e}}}}
        achados = []
        for _ in range(3):
            dados = self.post(corpo, CAMPOS)
            achados += dados.get("places", [])
            if not dados.get("nextPageToken"):
                break
            corpo["pageToken"] = dados["nextPageToken"]
        return achados


def varrer(api, texto, ret, vistos, prof=0):
    """Busca no retângulo; se encheu (60), divide em 4 e desce. ponytail: para em prof 6 (~1/4000 da área)."""
    achados = api.buscar(texto, ret)
    novos = [p for p in achados if p["id"] not in vistos]
    for p in novos:
        vistos[p["id"]] = p
    print(f"{'  ' * prof}prof {prof}: {len(achados)} achados, {len(novos)} novos | total {len(vistos)} | chamadas restantes {api.restam}")
    if len(achados) >= 60 and prof < 6:
        s, w, n, e = ret
        mlat, mlng = (s + n) / 2, (w + e) / 2
        for q in ((s, w, mlat, mlng), (s, mlng, mlat, e), (mlat, w, n, mlng), (mlat, mlng, n, e)):
            varrer(api, texto, q, vistos, prof + 1)


def sem_site(p):
    site = p.get("websiteUri", "")
    return p.get("businessStatus", "OPERATIONAL") == "OPERATIONAL" and (not site or any(r in site for r in REDES))


def main(nicho, cidade, max_chamadas=900):
    api = Places(chave(), int(max_chamadas))
    vistos = {}
    try:
        varrer(api, f"{nicho} em {cidade}", api.area_da_cidade(cidade), vistos)
    except TetoAtingido:
        print(f"\nParou antes do fim (teto de {max_chamadas} chamadas ou erro do Google). Salvando o que achou.")

    alvos = [p for p in vistos.values() if sem_site(p)]
    db = sqlite3.connect(DIR / "leads.db")
    db.execute("create table if not exists leads (place_id text primary key, nicho text, cidade text, coletado_em text, status text default 'novo')")
    hoje = datetime.date.today().isoformat()
    db.executemany("insert or ignore into leads (place_id, nicho, cidade, coletado_em) values (?,?,?,?)",
                   [(p["id"], nicho, cidade, hoje) for p in alvos])
    db.commit()

    (DIR / "saida").mkdir(exist_ok=True)
    arq = DIR / "saida" / f"{re.sub(r'\W+', '-', f'{nicho}-{cidade}').lower()}-{hoje}.csv"
    with open(arq, "w", newline="", encoding="utf-8-sig") as f:  # utf-8-sig abre certo no Excel
        w = csv.writer(f)
        w.writerow(["nome", "categoria", "telefone", "whatsapp_link", "endereco", "rede_social", "nota", "avaliacoes", "google_maps", "place_id"])
        for p in sorted(alvos, key=lambda p: -(p.get("userRatingCount") or 0)):  # mais avaliadas = mais movimento
            intl = re.sub(r"\D", "", p.get("internationalPhoneNumber", ""))
            w.writerow([p.get("displayName", {}).get("text", ""), p.get("primaryTypeDisplayName", {}).get("text", ""),
                        p.get("nationalPhoneNumber", ""), f"https://wa.me/{intl}" if intl else "", p.get("formattedAddress", ""),
                        p.get("websiteUri", ""), p.get("rating", ""), p.get("userRatingCount", ""), p.get("googleMapsUri", ""), p["id"]])
    print(f"\n{len(vistos)} lojas varridas | {len(alvos)} sem site -> {arq}")


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        sys.exit(__doc__)
    for nicho in sys.argv[1].split(","):  # "pizzaria,sushi" roda um de cada vez
        main(nicho.strip(), *sys.argv[2:])
