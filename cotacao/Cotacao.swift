import SwiftUI

struct Cotacao: Decodable {
    let code: String, bid: String, pctChange: String, create_date: String
}

@MainActor
final class Modelo: ObservableObject {
    @AppStorage("moedas") var moedas = "USD,EUR,GBP,AUD"
    @Published var itens: [Cotacao] = []
    @Published var erro = false
    @Published var hora = "—"
    private var timer: Timer?

    init() {
        timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { await self?.atualizar() }
        }
        Task { await atualizar() }
    }

    var codigos: [String] {
        moedas.uppercased().split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    var titulo: String {
        itens.isEmpty ? "R$ …" : itens.map { "\($0.code) \(fmt($0.bid))" }.joined(separator: "  ")
    }

    func atualizar() async {
        let pares = codigos.map { "\($0)-BRL" }.joined(separator: ",")
        guard let url = URL(string: "https://economia.awesomeapi.com.br/last/\(pares)") else { return }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let dict = try JSONDecoder().decode([String: Cotacao].self, from: data)
            itens = codigos.compactMap { dict[$0 + "BRL"] }
            hora = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .short)
            erro = false
        } catch {
            erro = true
        }
    }

    func fmt(_ s: String, casas: Int = 2) -> String {
        let v = Double(s) ?? 0
        let f = NumberFormatter()
        f.locale = Locale(identifier: "pt_BR")
        f.minimumFractionDigits = v >= 1000 ? 0 : casas
        f.maximumFractionDigits = v >= 1000 ? 0 : casas
        return f.string(from: v as NSNumber) ?? s
    }
}

@main
struct CotacaoApp: App {
    @StateObject private var m = Modelo()

    var body: some Scene {
        MenuBarExtra {
            ForEach(m.itens, id: \.code) { c in
                let pct = Double(c.pctChange) ?? 0
                Text("\(c.code)/BRL  R$ \(m.fmt(c.bid))   \(pct >= 0 ? "▲" : "▼") \(m.fmt(c.pctChange))%")
            }
            Divider()
            Text(m.erro ? "Sem conexão — último valor \(m.hora)" : "Atualizado \(m.hora)")
            Button("Atualizar agora") { Task { await m.atualizar() } }
            Divider()
            TextField("Moedas (ex.: USD,EUR,GBP,AUD)", text: $m.moedas)
                .onSubmit { Task { await m.atualizar() } }
            Divider()
            Button("Sair") { NSApplication.shared.terminate(nil) }
        } label: {
            Text(m.titulo).monospacedDigit()
        }
    }
}
