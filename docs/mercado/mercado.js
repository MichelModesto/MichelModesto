'use strict';

/* ---------- utilitários (mesmos do painel de finanças) ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = v => fmtBRL.format(Number(v) || 0);
const pct = (v, d = 1) => (Number(v || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
const spct = (v, d = 1) => (v > 0.0005 ? '+' : '') + pct(v, d);
const num = (v, d = 3) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: d });
const fmtDate = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const curta = iso => `${+iso.slice(8, 10)} ${MES[+iso.slice(5, 7) - 1]}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cls = v => v > 0.0005 ? 'bad' : v < -0.0005 ? 'good' : '';   // preço subir é ruim
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const soma = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
const tile = (label, value, sub = '', c = '') =>
  `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value ${c}">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ''}</div>`;
const qtdTxt = i => i.un === 'KG' ? `${num(i.qtd)} kg × ${brl(i.unit)}/kg` : `${num(i.qtd, 0)} × ${brl(i.unit)}`;
const porMed = i => i.kg ? `${brl(i.unit / i.kg)}/${i.med}` : '';
const embTxt = i => i.kg < 1 ? `${num(i.kg * 1000, 1)} ${i.med === 'L' ? 'ml' : 'g'}` : `${num(i.kg)} ${i.med}`;
const APELIDOS = { SENDAS: 'Assaí', ATACADAO: 'Atacadão' };   // razão social -> nome da fachada
const lojaCurta = s => { const w = String(s || '').replace(/^(GRUPO|SUPERMERCADOS?|COMERCIAL|MERCADO)\s+/i, '').split(/\s+/)[0] || 'Mercado'; return APELIDOS[w.toUpperCase()] || w[0] + w.slice(1).toLowerCase(); };

const state = { dados: null, i: 0, tab: 'resumo', q: '', filtro: 'mudou' };
const charts = [];

/* ---------- criptografia (WebCrypto) ---------- */
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function decrypt(pkg, pwd) {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey('raw', enc.encode(pwd), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64(pkg.salt), iterations: pkg.iter, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(pkg.iv) }, key, b64(pkg.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

// mesma chave do painel de finanças: entrou num, entrou no outro
async function tryUnlock(pwd, remember) {
  const st = $('#lock-status'), btn = $('#unlock');
  st.textContent = 'Abrindo…'; st.classList.remove('err'); btn.disabled = true;
  try {
    const res = await fetch('dados.enc?v=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('fetch');
    state.dados = preparar(await decrypt(await res.json(), pwd));
    try { remember ? localStorage.setItem('fin_pwd', pwd) : localStorage.removeItem('fin_pwd'); } catch (e) { /* bloqueado */ }
    st.textContent = '';
    start();
  } catch (err) {
    st.textContent = err.message === 'fetch' ? 'Não encontrei o arquivo de dados.' : 'Senha incorreta.';
    st.classList.add('err');
    try { localStorage.removeItem('fin_pwd'); } catch (e) { /* bloqueado */ }
    $('#pwd').focus();
  } finally {
    btn.disabled = false;
  }
}

function init() {
  $('#lock-form').addEventListener('submit', e => { e.preventDefault(); tryUnlock($('#pwd').value, $('#remember').checked); });
  $('#logout').addEventListener('click', () => { try { localStorage.removeItem('fin_pwd'); } catch (e) { /* */ } location.reload(); });
  let saved = null;
  try { saved = localStorage.getItem('fin_pwd'); } catch (e) { /* armazenamento bloqueado */ }
  if (saved) tryUnlock(saved, true); else $('#pwd').focus();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state.dados && render());
}

/* ---------- dados derivados ---------- */
function preparar(d) {
  const sup = new Set(d.superfluos);
  const C = d.compras;
  const hist = new Map();                       // ean -> [{i, loja, unit, qtd, nome, un}]
  // "casa" = mercado onde você mais compra; variação de preço só compara dentro do mesmo mercado
  const freq = {};
  C.forEach(c => { freq[c.loja] = (freq[c.loja] || 0) + 1; });
  d.casa = C.map(c => c.loja).reduce((a, l) => freq[l] >= freq[a] ? l : a, C[0].loja);
  d.multi = Object.keys(freq).length > 1;
  C.forEach((c, i) => {
    // mesmo produto em duas linhas da nota vira uma só
    const porEan = new Map();
    c.itens.forEach(it => {
      it.sup = sup.has(it.cat);
      const j = porEan.get(it.ean);
      if (j) { j.qtd += it.qtd; j.valor += it.valor; } else porEan.set(it.ean, { ...it });
    });
    c.linhas = [...porEan.values()];
    c.linhas.forEach(it => (hist.get(it.ean) || hist.set(it.ean, []).get(it.ean)).push({ i, loja: c.loja, unit: it.unit, qtd: it.qtd, nome: it.nome, un: it.un, cat: it.cat, kg: it.kg, med: it.med }));
    c.superfluo = soma(c.itens.filter(x => x.sup), x => x.valor);
    c.unidades = soma(c.itens, x => x.un === 'KG' ? 1 : x.qtd);
  });
  // preço na compra anterior em que o produto apareceu
  C.forEach((c, i) => c.linhas.forEach(it => {
    const ant = hist.get(it.ean).filter(h => h.i < i && h.loja === c.loja).pop();
    it.antes = ant ? ant.unit : null;
    it.var = ant ? it.unit / ant.unit - 1 : null;
  }));
  // cesta: o que veio na compra anterior (mesmo mercado) e se repetiu, na quantidade de antes, a preço de agora
  C.forEach((c, i) => {
    const prev = C.slice(0, i).filter(x => x.loja === c.loja).pop();
    if (!prev) return;
    const agora = new Map(c.linhas.map(x => [x.ean, x.unit]));
    const comuns = prev.linhas.filter(x => agora.has(x.ean));
    const antes = soma(comuns, x => x.qtd * x.unit), depois = soma(comuns, x => x.qtd * agora.get(x.ean));
    c.cesta = comuns.length ? { n: comuns.length, antes, depois, var: depois / antes - 1 } : null;
  });
  d.acumulado = C.reduce((a, c) => a * (1 + (c.cesta ? c.cesta.var : 0)), 1) - 1;
  d.produtos = [...hist.entries()].map(([ean, h]) => {
    const hc = h.filter(x => x.loja === d.casa);
    return {
      ean, h, nome: h[h.length - 1].nome, cat: h[0].cat, un: h[0].un, ult: h[h.length - 1], casa: hc[hc.length - 1] || null,
      var: hc.length > 1 ? hc[hc.length - 1].unit / hc[0].unit - 1 : null,
      gasto: soma(C.flatMap(c => c.linhas.filter(x => x.ean === ean)), x => x.valor),
    };
  });
  d.fora = precosFora(d);
  return d;
}

// preços fora da "casa": aba Cotação + notas de outros mercados; fica o mais recente de cada mercado
function precosFora(d) {
  const C = d.compras;
  const doNotas = C.filter(c => c.loja !== d.casa).flatMap(c => c.linhas.map(x => ({ mercado: lojaCurta(c.loja), data: c.data, ean: x.ean, nome: x.nome, preco: x.unit })));
  const todos = [...(d.cotacao || []), ...doNotas].sort((a, b) => (a.data || '').localeCompare(b.data || ''));
  const porEan = new Map(d.produtos.map(p => [p.ean, p]));
  const porNome = new Map(d.produtos.map(p => [p.nome.toUpperCase(), p]));
  const ultimo = new Map(), soltos = [];
  todos.forEach(x => {
    const p = (x.ean && porEan.get(x.ean)) || porNome.get(x.nome.toUpperCase());
    if (!p || !p.casa) { if (!p) soltos.push(x); return; }
    ultimo.set(`${x.mercado}|${p.ean}`, { ...x, p });
  });
  const porProduto = new Map();
  ultimo.forEach(x => (porProduto.get(x.p) || porProduto.set(x.p, []).get(x.p)).push(x));
  return { porProduto, soltos };
}

function start() {
  const d = state.dados;
  state.i = d.compras.length - 1;
  $('#updated').textContent = `${d.compras.length} compras · planilha de ${fmtDate(d.gerado_em.slice(0, 10))}`;
  $('#lock').classList.add('hidden');
  $('#app').classList.remove('hidden');
  renderChips();
  render(true);
}

/* ---------- render ---------- */
function renderChips() {
  $('#months').innerHTML = state.dados.compras.map((c, i) =>
    `<button class="chip ${i === state.i ? 'active' : ''}" data-i="${i}">${curta(c.data)}${state.dados.multi ? ` · ${esc(lojaCurta(c.loja))}` : ''}</button>`).join('');
  const act = $('#months .chip.active');
  if (act) act.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function render(toTop = false) {
  charts.forEach(c => c.destroy()); charts.length = 0;
  const d = state.dados, c = d.compras[state.i];
  $$('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
  $('#months').classList.toggle('hidden', state.tab === 'precos' || state.tab === 'lista');
  $('#view').innerHTML = { resumo: renderResumo, precos: renderPrecos, itens: renderItens, lista: renderLista }[state.tab](c, d);
  if (state.tab === 'resumo') graficos(d);
  if (toTop) window.scrollTo({ top: 0 });
}

/* --- Resumo --- */
function renderResumo(c, d) {
  const ant = d.compras[state.i - 1];
  const media = soma(d.compras, x => x.total) / d.compras.length;
  const mediaSup = soma(d.compras, x => x.superfluo) / soma(d.compras, x => x.total);
  const cats = {};
  c.itens.forEach(x => { cats[x.cat] = (cats[x.cat] || 0) + x.valor; });
  const lista = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const max = lista.length ? lista[0][1] : 1;
  const supSet = new Set(d.superfluos);
  const subiram = c.linhas.filter(x => x.var > 0.0005).sort((a, b) => b.var - a.var);
  const cairam = c.linhas.filter(x => x.var < -0.0005);
  const repetidos = c.linhas.filter(x => x.antes != null);
  const pesoSubida = soma(subiram, x => (x.unit - x.antes) * x.qtd);
  const tips = [];
  tips.push(`<b>${pct(c.superfluo / c.total, 0)}</b> desta compra (${brl(c.superfluo)}) foi em ${d.superfluos.join(', ').toLowerCase()}. Média de todas as compras: ${pct(mediaSup, 0)}.`);
  if (d.teto && c.superfluo > d.teto) tips.push(`Passou do teto de supérfluos (${brl(d.teto)}) em <b class="bad">${brl(c.superfluo - d.teto)}</b>.`);
  if (c.cesta) tips.push(`Os <b>${c.cesta.n}</b> produtos que você repetiu da compra anterior${d.multi ? ' no mesmo mercado' : ''} custaram <b class="${cls(c.cesta.var)}">${spct(c.cesta.var)}</b> (${brl(c.cesta.antes)} → ${brl(c.cesta.depois)} na mesma quantidade).`);
  if (subiram.length) tips.push(`Subiram de preço: ${subiram.slice(0, 4).map(x => `<b>${esc(x.nome)}</b> ${spct(x.var, 0)}`).join(', ')}${subiram.length > 4 ? ` e mais ${subiram.length - 4}` : ''}. Custo extra nesta compra: <b>${brl(pesoSubida)}</b>.`);
  if (cairam.length) tips.push(`Ficaram mais baratos: ${cairam.map(x => `${esc(x.nome)} ${spct(x.var, 0)}`).join(', ')}.`);
  return `
  <section class="card">
    <div class="hero-label">Compra de ${fmtDate(c.data)}</div>
    <div class="hero-value">${brl(c.total)}</div>
    <div class="hero-sub">${c.itens.length} linhas na nota · ${esc(c.loja)}</div>
    ${ant ? `<div class="hero-sub" style="margin-top:6px">Compra anterior${d.multi ? ` (${esc(lojaCurta(ant.loja))})` : ''} <b>${brl(ant.total)}</b> · diferença <b class="${cls(c.total - ant.total)}">${c.total >= ant.total ? '+' : ''}${brl(c.total - ant.total)}</b></div>` : ''}
  </section>
  <section class="kpis">
    ${tile('Supérfluos', brl(c.superfluo), d.teto ? `teto ${brl(d.teto)} · ${c.superfluo > d.teto ? `passou ${brl(c.superfluo - d.teto)}` : 'dentro'}` : `${pct(c.superfluo / c.total, 0)} da compra`, (d.teto ? c.superfluo > d.teto : c.superfluo / c.total > mediaSup + 0.02) ? 'neg' : 'pos')}
    ${tile('Essencial', brl(c.total - c.superfluo), `${pct(1 - c.superfluo / c.total, 0)} da compra`)}
    ${tile('Preço da cesta', c.cesta ? spct(c.cesta.var) : '—', c.cesta ? `${c.cesta.n} itens repetidos` : 'primeira compra', c.cesta ? (c.cesta.var > 0 ? 'neg' : 'pos') : '')}
    ${tile('Média por compra', brl(media), `${d.compras.length} compras`)}
    ${tile('Produtos repetidos', `${repetidos.length}`, `de ${c.linhas.length} diferentes`)}
    ${tile('Subiram / caíram', `${subiram.length} / ${cairam.length}`, 'vs última vez que comprou')}
  </section>
  <section class="card">
    <h2>O que chama atenção</h2>
    ${tips.map(t => `<p class="tip">${t}</p>`).join('')}
  </section>
  <section class="card">
    <h2>Por categoria <small>laranja = supérfluo</small></h2>
    <div class="bars">${lista.map(([k, v]) => `
      <div class="bar-row">
        <span class="bar-name">${esc(k)}</span>
        <span class="bar-val">${brl(v)}<span class="bar-pct">${pct(v / c.total, 0)}</span></span>
        <div class="bar-track"><div class="bar-fill ${supSet.has(k) ? 'sup' : ''}" style="width:${v / max * 100}%"></div></div>
      </div>`).join('')}</div>
  </section>
  <section class="card"><h2>Compra a compra <small>essencial × supérfluo</small></h2><div class="chart"><canvas id="ch-compras"></canvas></div></section>
  <section class="card"><h2>Onde vai o dinheiro <small>todas as compras</small></h2><div class="list">${
    [...d.produtos].sort((a, b) => b.gasto - a.gasto).slice(0, 10).map(p => `
      <div class="row">
        <div class="row-main"><span class="row-title">${esc(p.nome)}</span><span class="row-sub"><span class="badge ${supSet.has(p.cat) ? 'warn' : ''}">${esc(p.cat)}</span><span>em ${p.h.length} de ${d.compras.length} compras</span></span></div>
        <div class="row-side"><span class="row-val">${brl(p.gasto)}</span></div>
      </div>`).join('')}</div></section>`;
}

/* --- Preços --- */
const busca = ph => `<input class="search" type="search" id="busca" placeholder="${ph}" value="${esc(state.q)}" autocomplete="off">`;

function renderPrecos(c, d) {
  const q = state.q.trim().toUpperCase();
  const bate = (nome, cat = '') => !q || nome.toUpperCase().includes(q) || cat.toUpperCase().includes(q);
  const segs = [['mudou', 'Variação'], ['kg', 'Por kg / L'], ['mercados', 'Outros mercados']];
  const view = { mudou: precosVariacao, kg: precosKg, mercados: precosMercados }[state.filtro] || precosVariacao;
  return `<div class="seg">${segs.map(([k, l]) => `<button data-filtro="${k}" class="${state.filtro === k ? 'active' : ''}">${l}</button>`).join('')}</div>${view(d, bate, q)}`;
}

function precosVariacao(d, bate, q) {
  const C = d.compras;
  const ps = d.produtos.filter(p => q ? bate(p.nome, p.cat) : p.var != null && Math.abs(p.var) > 0.0005)
    .sort((a, b) => (b.var ?? -9) - (a.var ?? -9) || a.nome.localeCompare(b.nome));
  const rep = d.produtos.filter(p => p.var != null);
  const sub = rep.filter(p => p.var > 0.0005).length, cai = rep.filter(p => p.var < -0.0005).length;
  return `
  <section class="card">
    <div class="hero-label">Sua cesta ficou mais cara em</div>
    <div class="hero-value ${cls(d.acumulado) === 'bad' ? 'neg' : 'pos'}">${spct(d.acumulado)}</div>
    <div class="hero-sub">de ${fmtDate(C[0].data)} a ${fmtDate(C[C.length - 1].data)}, somando ${C.filter(x => x.cesta).map(x => x.cesta ? `<b>${spct(x.cesta.var)}</b>` : '—').join(' e ')} entre compras</div>
    <p class="legend-note">Mesmo produto (código de barras) na mesma quantidade, compra contra a anterior. Não depende do que você escolheu levar a mais ou a menos.</p>
  </section>
  <section class="kpis">
    ${tile('Comprados 2+ vezes', `${rep.length}`, `de ${d.produtos.length} produtos`)}
    ${tile('Subiram', `${sub}`, 'primeira × última compra', sub ? 'neg' : '')}
    ${tile('Caíram', `${cai}`, 'primeira × última compra', cai ? 'pos' : '')}
  </section>
  <section class="card">
    <h2>${q ? 'Resultado da busca' : 'Mudaram de preço'} <small>${ps.length}</small></h2>
    ${busca('Buscar produto ou categoria (todas as compras)')}
    ${ps.length ? `<div class="list">${ps.map(p => `
      <div class="row">
        <div class="row-main">
          <span class="row-title">${esc(p.nome)}</span>
          <span class="row-sub trail">${p.h.map(h => `${curta(C[h.i].data)}${d.multi ? ` (${esc(lojaCurta(h.loja))})` : ''} ${brl(h.unit)}${p.un === 'KG' ? '/kg' : ''}`).join(' → ')}</span>
        </div>
        <div class="row-side">${p.var != null ? `<span class="badge ${cls(p.var)}">${spct(p.var, 0)}</span>` : '<span class="badge">1 compra</span>'}</div>
      </div>`).join('')}</div>` : '<p class="empty">Nada encontrado.</p>'}
  </section>`;
}

function precosKg(d, bate) {
  const com = d.produtos.filter(p => p.ult.kg), sem = d.produtos.length - com.length;
  const grupos = {};
  com.filter(p => bate(p.nome, p.cat)).forEach(p => (grupos[p.cat] ||= []).push(p));
  const ordem = Object.keys(grupos).sort((a, b) => a.localeCompare(b));
  return `
  <section class="card">
    <h2>Preço por kg / litro <small>último preço pago</small></h2>
    <p class="legend-note" style="margin-top:0">Pacote maior nem sempre sai mais barato. Busque o produto (ex.: <b>AMEND</b>, <b>IOG</b>, <b>BOMBOM</b>) para comparar embalagens e marcas lado a lado.
    ${sem ? ` ${sem} produtos ainda sem peso: preencha a aba <b>Pesos</b> da planilha.` : ''}</p>
    ${busca('Buscar produto ou categoria')}
    ${ordem.length ? ordem.map(k => `
      <div class="group-title">${esc(k)}</div>
      <div class="list">${grupos[k].sort((a, b) => a.ult.unit / a.ult.kg - b.ult.unit / b.ult.kg).map(p => `
        <div class="row">
          <div class="row-main">
            <span class="row-title">${esc(p.nome)}</span>
            <span class="row-sub">${p.un === 'KG' ? '<span>pesável</span>' : `<span>${embTxt(p.ult)} por ${brl(p.ult.unit)}</span>`}<span>${curta(d.compras[p.ult.i].data)}</span></span>
          </div>
          <div class="row-side"><span class="row-val">${porMed(p.ult)}</span></div>
        </div>`).join('')}</div>`).join('') : '<p class="empty">Nada encontrado.</p>'}
  </section>`;
}

function precosMercados(d, bate) {
  const { porProduto, soltos } = d.fora;
  if (!porProduto.size && !soltos.length) return `
  <section class="card">
    <h2>Outros mercados</h2>
    <p class="tip">Ainda não tem preço de outro mercado. Dois jeitos: colar na <b>mercado.xlsx</b> a nota de uma compra feita em outro mercado (aba nova, como as outras), ou preencher a aba <b>Cotação</b> (nome do mercado na linha 2, data na linha 3, preços embaixo; pesáveis por kg). Na Cotação já estão os produtos que você compra sempre.</p>
    <p class="tip">Depois rode o <b>publicar.sh</b>. Aqui aparece, produto a produto, quanto você pagou no seu mercado contra os outros, e quanto a compra toda sairia em cada um.</p>
  </section>`;
  const casa = lojaCurta(d.casa);
  const mercados = new Map();
  porProduto.forEach((xs, p) => xs.forEach(x => {
    const m = mercados.get(x.mercado) || mercados.set(x.mercado, { n: 0, aqui: 0, la: 0, datas: new Set() }).get(x.mercado);
    const q = p.casa.qtd;                         // pesa pelo quanto você costuma levar
    m.n++; m.aqui += p.casa.unit * q; m.la += x.preco * q; if (x.data) m.datas.add(x.data);
  }));
  const lista = [...porProduto.entries()].filter(([p]) => bate(p.nome, p.cat))
    .map(([p, xs]) => ({ p, xs, melhor: Math.min(...xs.map(x => x.preco)) - p.casa.unit }))
    .sort((a, b) => a.melhor - b.melhor);
  return `
  <section class="kpis">${[...mercados.entries()].map(([nome, m]) => {
    const v = m.la / m.aqui - 1;
    return tile(esc(nome), spct(v), `${m.n} itens · ${v < 0 ? 'economia' : 'a mais'} de ${brl(Math.abs(m.aqui - m.la))} vs ${esc(casa)}${m.datas.size ? ` · ${[...m.datas].sort().map(curta).join(', ')}` : ''}`, v < -0.0005 ? 'pos' : v > 0.0005 ? 'neg' : '');
  }).join('')}</section>
  <section class="card">
    <h2>Produto a produto <small>base: último preço no ${esc(casa)}</small></h2>
    ${busca('Buscar produto ou categoria')}
    ${lista.length ? `<div class="list">${lista.map(({ p, xs, melhor }) => `
      <div class="row">
        <div class="row-main">
          <span class="row-title">${esc(p.nome)}</span>
          <span class="row-sub"><span>${esc(casa)} ${brl(p.casa.unit)}${p.un === 'KG' ? '/kg' : ''}</span>${xs.map(x => {
            const v = x.preco / p.casa.unit - 1;
            return `<span class="badge ${cls(v)}">${esc(x.mercado)} ${brl(x.preco)} ${spct(v, 0)}</span>`;
          }).join('')}</span>
        </div>
        <div class="row-side"><span class="row-val ${melhor < -0.005 ? 'pos' : ''}">${melhor < -0.005 ? `−${brl(-melhor)}` : '—'}</span><span class="row-val small">${melhor < -0.005 ? 'mais barato fora' : `${esc(casa)} ganha`}</span></div>
      </div>`).join('')}</div>` : '<p class="empty">Nenhum produto em comum ainda.</p>'}
    <p class="legend-note">Percentual de cada mercado = a compra desses itens, nas quantidades que você costuma levar, lá contra aqui.</p>
    ${soltos.length ? `<p class="legend-note">Da cotação, não achei nas notas (confira código ou nome): ${soltos.map(x => esc(x.nome)).join(', ')}.</p>` : ''}
  </section>`;
}

/* --- Lista (o que você compra sempre) --- */
function renderLista(c, d) {
  const C = d.compras, n = C.length;
  const dias = n > 1 ? (new Date(C[n - 1].data) - new Date(C[0].data)) / 864e5 / (n - 1) : 30;
  const ps = d.produtos.filter(p => p.h.length >= 2).map(p => {
    const tot = soma(p.h, h => h.qtd);
    const fora = (d.fora.porProduto.get(p) || []).filter(x => p.casa && x.preco < p.casa.unit - 0.005).sort((a, b) => a.preco - b.preco)[0];
    return { p, porCompra: tot / p.h.length, porMes: tot / (n * dias) * 30, medio: p.gasto / n, fora };
  });
  const sempre = ps.filter(x => x.p.h.length === n).sort((a, b) => b.medio - a.medio);
  const quase = ps.filter(x => x.p.h.length < n).sort((a, b) => b.medio - a.medio);
  const media = soma(C, x => x.total) / n;
  const qtd = (x, v) => x.p.un === 'KG' ? `${num(v, 1)} kg` : `${num(v, 1)} un`;
  const row = x => `
    <div class="row">
      <div class="row-main">
        <span class="row-title">${esc(x.p.nome)}</span>
        <span class="row-sub"><span>~${qtd(x, x.porCompra)} por compra · ~${qtd(x, x.porMes)}/mês</span>${x.fora ? `<span class="badge good">${esc(x.fora.mercado)} ${spct(x.fora.preco / x.p.casa.unit - 1, 0)}</span>` : ''}</span>
      </div>
      <div class="row-side"><span class="row-val">${brl(x.medio)}</span><span class="row-val small">por compra</span></div>
    </div>`;
  const teto = d.teto;
  return `
  <section class="card">
    <div class="hero-label">Lista básica: o que vai em toda compra</div>
    <div class="hero-value">${brl(soma(sempre, x => x.medio))}</div>
    <div class="hero-sub"><b>${sempre.length}</b> produtos · ${pct(soma(sempre, x => x.medio) / media, 0)} da compra média de ${brl(media)}</div>
    <p class="legend-note">Isso é o piso: dá para prever e comprar em quantidade onde for mais barato. Quantidade por mês = tudo que você levou ÷ intervalo médio entre compras (${num(dias, 0)} dias).</p>
  </section>
  <section class="card">
    <h2>Teto de supérfluos <small>${teto ? `${brl(teto)} por compra` : 'sem teto'}</small></h2>
    ${teto ? `<div class="bars">${C.map(x => `
      <div class="bar-row">
        <span class="bar-name">${fmtDate(x.data)}${d.multi ? ` · ${esc(lojaCurta(x.loja))}` : ''}</span>
        <span class="bar-val ${x.superfluo > teto ? 'neg' : 'pos'}">${brl(x.superfluo)}<span class="bar-pct">${x.superfluo > teto ? `+${brl(x.superfluo - teto)}` : 'dentro'}</span></span>
        <div class="bar-track"><div class="bar-fill sup" style="width:${Math.min(100, x.superfluo / Math.max(teto, ...C.map(y => y.superfluo)) * 100)}%"></div><i class="bar-tick" style="left:${teto / Math.max(teto, ...C.map(y => y.superfluo)) * 100}%"></i></div>
      </div>`).join('')}</div>
    <p class="legend-note">Barra = supérfluos da compra · traço = teto. Muda o valor na aba <b>Config</b> da planilha.</p>`
    : '<p class="empty">Defina o teto na aba Config da planilha.</p>'}
  </section>
  <section class="card"><h2>Em todas as compras <small>${sempre.length}</small></h2><div class="list">${sempre.map(row).join('') || '<p class="empty">Precisa de 2 compras ou mais.</p>'}</div></section>
  ${quase.length ? `<section class="card"><h2>Em quase todas <small>${quase.length} · 2+ compras</small></h2><div class="list">${quase.map(row).join('')}</div></section>` : ''}`;
}

/* --- Itens --- */
function renderItens(c, d) {
  const q = state.q.trim().toUpperCase();
  const its = c.linhas.filter(x => !q || x.nome.toUpperCase().includes(q) || x.cat.toUpperCase().includes(q));
  const grupos = {};
  its.forEach(x => (grupos[x.cat] ||= []).push(x));
  const ordem = Object.entries(grupos).map(([k, v]) => [k, v.sort((a, b) => b.valor - a.valor), soma(v, x => x.valor)]).sort((a, b) => b[2] - a[2]);
  return `
  <section class="card">
    <input class="search" type="search" id="busca" placeholder="Buscar nesta compra" value="${esc(state.q)}" autocomplete="off">
    ${ordem.length ? ordem.map(([k, v, t]) => `
      <div class="group-title">${esc(k)} · ${brl(t)}</div>
      <div class="list">${v.map(x => `
        <div class="row">
          <div class="row-main">
            <span class="row-title">${esc(x.nome)}</span>
            <span class="row-sub"><span>${qtdTxt(x)}</span>${x.kg && x.un !== 'KG' ? `<span>${porMed(x)}</span>` : ''}${x.var != null && Math.abs(x.var) > 0.0005 ? `<span class="badge ${cls(x.var)}">${spct(x.var, 0)} (era ${brl(x.antes)})</span>` : x.antes == null && state.i ? '<span class="badge">novo</span>' : ''}</span>
          </div>
          <div class="row-side"><span class="row-val">${brl(x.valor)}</span></div>
        </div>`).join('')}</div>`).join('') : '<p class="empty">Nada encontrado.</p>'}
    <div class="total-row"><span>Total da nota</span><span>${brl(c.total)}</span></div>
  </section>`;
}

/* ---------- gráfico ---------- */
function graficos(d) {
  const el = document.getElementById('ch-compras');
  if (!el || !window.Chart) return;
  const muted = css('--muted'), grid = css('--grid'), text2 = css('--text-2');
  const C = d.compras, bar = { borderRadius: 4, maxBarThickness: 36 };
  charts.push(new Chart(el, {
    type: 'bar',
    data: {
      labels: C.map(x => curta(x.data)),
      datasets: [
        { label: 'Essencial', data: C.map(x => x.total - x.superfluo), backgroundColor: css('--accent'), ...bar },
        { label: 'Supérfluo', data: C.map(x => x.superfluo), backgroundColor: css('--series-2'), ...bar },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { color: text2, boxWidth: 8, boxHeight: 8, usePointStyle: true, padding: 14 } },
        tooltip: { callbacks: { label: t => ` ${t.dataset.label}: ${brl(t.parsed.y)}`, footer: t => `Total: ${brl(soma(t, x => x.parsed.y))}` } },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, border: { color: grid }, ticks: { color: muted, font: { size: 11 } } },
        y: { stacked: true, beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: muted, font: { size: 11 } } },
      },
    },
  }));
}

/* ---------- eventos ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab],[data-i],[data-filtro]');
  if (!t || !state.dados) return;
  let toTop = false;
  if (t.dataset.tab) { if (state.tab !== t.dataset.tab) state.q = ''; state.tab = t.dataset.tab; toTop = true; }
  if (t.dataset.i != null) { state.i = +t.dataset.i; renderChips(); }
  if (t.dataset.filtro) state.filtro = t.dataset.filtro;
  render(toTop);
});
document.addEventListener('input', e => {
  if (e.target.id !== 'busca') return;
  state.q = e.target.value;
  const pos = e.target.selectionStart;
  render();
  const b = $('#busca'); b.focus(); b.setSelectionRange(pos, pos);
});

if (window.Chart) Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
init();
