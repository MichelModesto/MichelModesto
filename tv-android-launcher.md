# TV Android do quarto: sem anúncios + launcher estilo Apple TV

Base: https://github.com/Gathin23/cleanyourtv (MIT). Funciona em Android TV / Google TV.
Não funciona na Samsung (Tizen).

## 1. Na TV (2 min)

1. *Configurações → Preferências do dispositivo → Sobre*.
2. Em **Build** (ou "Versão do build"), apertar OK **7 vezes**, até aparecer "Você agora é um desenvolvedor".
3. Voltar e abrir *Opções do desenvolvedor*. Ligar **Depuração USB**. Se aparecer **Depuração de rede** ou **ADB pela rede**, ligar também.
4. Anotar o **IP** da TV em *Configurações → Rede → (sua rede)*.
5. Deixar a TV ligada.

## 2. Anotar antes de começar

- Modelo do aparelho (em *Sobre*): `__________`
- IP da TV: `__________`
- Algo ligado na USB da TV? `__________` (alguns aparelhos cortam a energia da USB com a depuração ligada)
- 4 apps da barra de baixo, em ordem: `__________`
- Usa assistente de voz / Chromecast / atualizações automáticas? `__________`

## 3. No Mac (Mac e TV no mesmo Wi-Fi)

O `adb` já está instalado (`~/Library/Android/sdk/platform-tools/adb`).

```bash
cd ~/Dev && git clone https://github.com/Gathin23/cleanyourtv
cd cleanyourtv && claude
```

Colar no Claude:

> Siga o PROMPT.md deste repo na minha TV. Modelo: <MODELO>. IP: <IP>. Reaproveite `tools/` e
> `launcher/` em vez de escrever do zero. Faça backup e o script de restauração antes de tudo, e
> me pergunte antes de desativar qualquer app que eu possa usar.

Quando o Claude avisar, aceitar **"Permitir depuração USB?"** na TV.

O que ele faz:
1. Backup de pacotes e configurações, mais um script que desfaz tudo.
2. Desativa anúncios, telemetria e apps de fábrica. Nada é desinstalado.
3. Compila e instala o launcher novo e o põe como tela inicial.
4. Confere cada etapa com print da tela da TV.

Leva uns 15 minutos.

## 4. Deixar com a minha cara

- Rápido, sem recompilar: temas em `themes/` (cores, papel de parede, apps da barra, colunas) via `config.json`.
- Layout inteiro: editar `launcher/` (o código é aberto).
- Antes de desenhar, passar pelo `diretor-de-arte`.

## 5. No fim

- **Desligar a Depuração USB** na TV.
- Se der problema, rodar o script de restauração que fica na pasta de backup.
