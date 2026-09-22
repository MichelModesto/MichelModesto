# Cotação

Cotações de moedas contra o real, sempre visíveis. Fonte: [AwesomeAPI](https://docs.awesomeapi.com.br/api-de-moedas) (tempo real, sem chave). Atualiza a cada 30 s.

## 1. Página web (título da aba)

`https://michelmodesto.github.io/MichelModesto/cotacao.html` — tela cheia com números grandes e o título da aba mostra `USD 5,11 · EUR 5,85 · …`. Deixe a aba aberta (ou instale como app pelo menu do Chrome).

Moedas: campo no rodapé ou `?m=USD,EUR,BTC` na URL. Fica salvo no navegador.

## 2. App de barra de menus (Mac)

```sh
./instalar.sh
```

Compila `Cotacao.swift` (só precisa do Xcode/Command Line Tools), instala em `~/Applications/Cotacao.app` e cria um LaunchAgent para abrir no login. Clique no texto na barra de menus para ver variação, atualizar ou trocar as moedas.

Remover: `launchctl bootout gui/$(id -u)/com.michelmodesto.cotacao && rm ~/Library/LaunchAgents/com.michelmodesto.cotacao.plist`.

## Limitações

- Tela de bloqueio: o macOS não permite widgets nem itens de barra de menus ali. Só com app de terceiros (ex.: WidgetScreen).
- Apps em tela cheia escondem a barra de menus; ela aparece ao levar o mouse ao topo.
