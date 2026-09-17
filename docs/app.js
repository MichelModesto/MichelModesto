'use strict';

/* ---------- utilitários ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = v => fmtBRL.format(Number(v) || 0);
const pct = (v, d = 1) => (Number(v || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
const num = (v, d = 2) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: d });
const fmtDate = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';
const fmtDia = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sign = v => v < -0.005 ? 'neg' : v > 0.005 ? 'pos' : '';
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const compact = v => Math.abs(v) >= 1000 ? (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : v.toLocaleString('pt-BR');
const tile = (label, value, sub = '', cls = '') =>
  `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value ${cls}">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ''}</div>`;

const state = { dados: null, mes: 0, tab: 'resumo', sub: 'cartao', cat: 'Todas' };
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

/* ---------- tela de senha ---------- */
async function tryUnlock(pwd, remember) {
  const st = $('#lock-status'), btn = $('#unlock');
  st.textContent = 'Abrindo…'; st.classList.remove('err'); btn.disabled = true;
  try {
    const res = await fetch('dados.enc?v=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('fetch');
    state.dados = await decrypt(await res.json(), pwd);
    if (remember) localStorage.setItem('fin_pwd', pwd); else localStorage.removeItem('fin_pwd');
    st.textContent = '';
    start();
  } catch (err) {
    st.textContent = err.message === 'fetch' ? 'Não encontrei o arquivo de dados.' : 'Senha incorreta.';
    st.classList.add('err');
    localStorage.removeItem('fin_pwd');
    $('#pwd').focus();
  } finally {
    btn.disabled = false;
  }
}

function init() {
  $('#lock-form').addEventListener('submit', e => { e.preventDefault(); tryUnlock($('#pwd').value, $('#remember').checked); });
  $('#logout').addEventListener('click', () => { localStorage.removeItem('fin_pwd'); location.reload(); });
  let saved = null;
  try { saved = localStorage.getItem('fin_pwd'); } catch (e) { /* armazenamento bloqueado */ }
  if (saved) tryUnlock(saved, true); else $('#pwd').focus();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state.dados && render());
}

/* ---------- estado do mês ---------- */
function situacao(m) {
  const hoje = new Date();
  const ini = new Date(m.ano, m.mes - 1, 1), fim = new Date(m.ano, m.mes, 1);
  if (ini > hoje) return 'Previsto';
  if (fim <= hoje) return 'Fechado';
  return 'Em curso';
}
const sitClass = s => s === 'Em curso' ? 'accent' : s === 'Fechado' ? 'good' : '';

function start() {
  const d = state.dados;
  let idx = d.meses.findIndex(x => situacao(x) === 'Em curso');
  if (idx < 0) { idx = d.meses.map(situacao).lastIndexOf('Fechado'); if (idx < 0) idx = 0; }
  state.mes = idx;
  $('#updated').textContent = `Atualizado em ${fmtDate(d.gerado_em.slice(0, 10))} às ${d.gerado_em.slice(11, 16)}`;
  $('#lock').classList.add('hidden');
  $('#app').classList.remove('hidden');
  renderMonths();
  render(true);
}

/* ---------- render ---------- */
function renderMonths() {
  $('#months').innerHTML = state.dados.meses.map((m, i) => {
    const s = situacao(m);
    return `<button class="chip ${i === state.mes ? 'active' : ''} ${s === 'Previsto' ? 'future' : ''}" data-mes="${i}">${esc(m.rotulo)}</button>`;
  }).join('');
  const act = $('#months .chip.active');
  if (act) act.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function render(toTop = false) {
  charts.forEach(c => c.destroy()); charts.length = 0;
  const d = state.dados, m = d.meses[state.mes];
  $$('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
  $('#months').classList.toggle('hidden', !(state.tab === 'resumo' || state.tab === 'gastos'));
  const views = { resumo: renderResumo, gastos: renderGastos, investir: renderInvestir, imovel: renderImovel, metas: renderMetas };
  $('#view').innerHTML = views[state.tab](m, d);
  afterRender(m, d);
  if (toTop) window.scrollTo({ top: 0 });
}

/* --- Resumo --- */
function renderResumo(m, d) {
  const r = m.resumo, s = situacao(m), p = r.pct || 0;
  const cats = m.categorias.filter(c => c.total > 0).sort((a, b) => b.total - a.total);
  const max = cats.length ? cats[0].total : 1;
  const comReal = m.fixos.filter(f => f.real != null).length;
  const tiles = [
    ['Entradas', brl(m.entradas), m.outras ? `líquido ${brl(m.liquido)} + outras ${brl(m.outras)}` : 'salário líquido'],
    ['Dízimo', brl(r.dizimo), `${pct(d.pct_dizimo, 0)} do bruto de ${brl(m.bruto)}`],
    ['Gastos fixos', brl(r.fixos), `${comReal} de ${m.fixos.length} com valor real`],
    ['Cartão', brl(r.cartao), `${m.cartao.length} lançamentos`],
    ['Débito / Pix', brl(r.variaveis), `${m.variaveis.length} lançamentos`],
    ['Aportes', brl(r.aportes), `saldo após investir ${brl(r.saldo)}`],
  ];
  return `
  <section class="card">
    <div class="hero-label">Sobra de ${esc(m.nome)} <span class="badge ${sitClass(s)}">${s}</span></div>
    <div class="hero-value ${sign(r.sobra)}">${brl(r.sobra)}</div>
    <div class="hero-sub">Entradas <b>${brl(m.entradas)}</b> · Saídas <b>${brl(r.saidas)}</b></div>
    <div class="meter"><div class="meter-fill ${p >= .9 ? 'crit' : p >= .75 ? 'warn' : ''}" style="width:${Math.min(100, p * 100)}%"></div></div>
    <div class="meter-label">${pct(p)} da renda comprometida</div>
  </section>
  <section class="kpis">${tiles.map(([l, v, sub]) => tile(l, v, esc(sub))).join('')}</section>
  <section class="card">
    <h2>Gastos por categoria <small>sem dízimo</small></h2>
    ${cats.length ? `<div class="bars">${cats.map(c => `
      <div class="bar-row">
        <span class="bar-name">${esc(c.nome)}</span>
        <span class="bar-val">${brl(c.total)}<span class="bar-pct">${pct(c.pct, 0)}</span></span>
        <div class="bar-track"><div class="bar-fill" style="width:${c.total / max * 100}%"></div></div>
      </div>`).join('')}</div>` : '<p class="empty">Nada lançado ainda.</p>'}
  </section>
  <section class="card"><h2>Mês a mês <small>entradas × saídas</small></h2><div class="chart"><canvas id="ch-meses"></canvas></div></section>`;
}

/* --- Gastos --- */
const rowCartao = c => `
  <div class="row">
    <div class="row-main">
      <span class="row-title">${esc(c.descricao)}</span>
      <span class="row-sub">${c.categoria ? `<span class="badge">${esc(c.categoria)}</span>` : ''}${c.parcela ? `<span>parcela ${esc(c.parcela)}</span>` : ''}</span>
    </div>
    <div class="row-side"><span class="row-val">${brl(c.valor)}</span></div>
  </div>`;

function renderGastos(m) {
  const segs = [['cartao', 'Cartão'], ['fixos', 'Fixos'], ['variaveis', 'Débito / Pix']];
  const body = state.sub === 'fixos' ? renderFixos(m) : state.sub === 'variaveis' ? renderVariaveis(m) : renderCartao(m);
  return `<div class="seg">${segs.map(([k, l]) => `<button data-sub="${k}" class="${state.sub === k ? 'active' : ''}">${l}</button>`).join('')}</div>${body}`;
}

function renderCartao(m) {
  const auto = m.cartao.filter(c => c.auto), manual = m.cartao.filter(c => !c.auto);
  const catsPresent = [...new Set(manual.map(c => c.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (state.cat !== 'Todas' && !catsPresent.includes(state.cat)) state.cat = 'Todas';
  const filt = state.cat === 'Todas' ? manual : manual.filter(c => c.categoria === state.cat);
  const total = m.cartao.reduce((a, c) => a + c.valor, 0);
  const totalAuto = auto.reduce((a, c) => a + c.valor, 0);
  const totalFilt = filt.reduce((a, c) => a + c.valor, 0);
  const byDate = {};
  filt.forEach(c => { (byDate[c.data || ''] ||= []).push(c); });
  const dates = Object.keys(byDate).sort().reverse();
  return `
  <section class="card">
    <div class="hero-label">Fatura de ${esc(m.nome)}</div>
    <div class="hero-value">${brl(total)}</div>
    <div class="hero-sub">${auto.length ? `Parcelamentos <b>${brl(totalAuto)}</b> · ` : ''}Compras do mês <b>${brl(total - totalAuto)}</b></div>
  </section>
  ${auto.length ? `<section class="card"><h2>Parcelamentos</h2><div class="list">${auto.map(rowCartao).join('')}</div></section>` : ''}
  <section class="card">
    <h2>Compras <small>${filt.length} lançamentos · ${brl(totalFilt)}</small></h2>
    <div class="chips">${['Todas', ...catsPresent].map(c => `<button class="chip ${state.cat === c ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    ${dates.length
      ? dates.map(dt => `<div class="group-title">${dt ? fmtDate(dt) : 'Sem data'}</div><div class="list">${byDate[dt].map(rowCartao).join('')}</div>`).join('')
      : '<p class="empty">Nenhuma compra lançada.</p>'}
  </section>`;
}

function renderFixos(m) {
  const prev = m.fixos.reduce((a, f) => a + (f.previsto || 0), 0);
  const badge = f => f.pago === 'Sim' ? '<span class="badge good">Pago</span>'
    : f.pago === 'Não' ? '<span class="badge bad">Em aberto</span>'
    : f.real != null ? '<span class="badge accent">Lançado</span>' : '<span class="badge">Previsto</span>';
  return `
  <section class="card">
    <h2>Gastos fixos <small>previsto ${brl(prev)}</small></h2>
    <div class="list">${m.fixos.map(f => `
      <div class="row">
        <div class="row-main">
          <span class="row-title">${esc(f.nome)}</span>
          <span class="row-sub"><span class="badge">${esc(f.categoria || '')}</span>${f.dia ? `<span>dia ${f.dia}</span>` : ''}${badge(f)}</span>
        </div>
        <div class="row-side">
          <span class="row-val">${brl(f.considerado)}</span>
          ${f.real != null && f.previsto != null && Math.abs(f.real - f.previsto) > 0.005 ? `<span class="row-val small">previsto ${brl(f.previsto)}</span>` : ''}
        </div>
      </div>`).join('')}</div>
    <div class="total-row"><span>Total considerado</span><span>${brl(m.resumo.fixos)}</span></div>
  </section>`;
}

function renderVariaveis(m) {
  return `
  <section class="card">
    <h2>Débito, Pix e dinheiro <small>${brl(m.resumo.variaveis)}</small></h2>
    ${m.variaveis.length ? `<div class="list">${m.variaveis.map(v => `
      <div class="row">
        <div class="row-main">
          <span class="row-title">${esc(v.descricao)}</span>
          <span class="row-sub">${v.categoria ? `<span class="badge">${esc(v.categoria)}</span>` : ''}${v.data ? `<span>${fmtDia(v.data)}</span>` : ''}${v.forma ? `<span>${esc(v.forma)}</span>` : ''}</span>
        </div>
        <div class="row-side"><span class="row-val">${brl(v.valor)}</span></div>
      </div>`).join('')}</div>` : '<p class="empty">Nenhum lançamento no débito ou pix este mês.</p>'}
  </section>`;
}

/* --- Investir --- */
function renderInvestir(m, d) {
  const inv = d.investimentos, car = d.carteira;
  const cls = car.classes.filter(c => c.saldo > 0 || c.ideal > 0);
  const ativos = [...car.ativos].sort((a, b) => b.saldo - a.saldo);
  const prov = [...car.proventos].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  return `
  <section class="card">
    <div class="hero-label">Patrimônio investido ${car.atualizado_em ? `<span class="badge">em ${fmtDate(car.atualizado_em)}</span>` : ''}</div>
    <div class="hero-value">${brl(inv.patrimonio)}</div>
    <div class="hero-sub">Resultado sobre o custo <b class="${sign(car.total.resultado)}">${brl(car.total.resultado)} (${pct(car.total.rentab, 2)})</b></div>
  </section>
  <section class="kpis four">
    ${tile('Rendimento', brl(inv.rendimento), 'desde a 1ª linha do histórico', sign(inv.rendimento))}
    ${tile('Aportes', brl(inv.aportado), 'total no período')}
    ${tile('Proventos', brl(car.proventos_total), 'dividendos, JSCP e FIIs')}
    ${tile('Rentabilidade', pct(inv.rentabilidade, 2), 'rendimento ÷ (inicial + aportes)')}
  </section>
  <section class="card"><h2>Patrimônio por mês</h2><div class="chart"><canvas id="ch-patri"></canvas></div></section>
  ${inv.historico.length >= 2 ? '<section class="card"><h2>Evolução semanal</h2><div class="chart"><canvas id="ch-hist"></canvas></div></section>' : ''}
  <section class="card">
    <h2>Carteira por classe <small>atual × ideal</small></h2>
    <div class="bars">${cls.map(c => `
      <div class="bar-row">
        <span class="bar-name">${esc(c.classe)}</span>
        <span class="bar-val">${brl(c.saldo)}<span class="bar-pct">${pct(c.pct, 0)} de ${pct(c.ideal, 0)}</span></span>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, c.pct * 100)}%"></div><i class="bar-tick" style="left:${Math.min(100, c.ideal * 100)}%"></i></div>
        ${c.falta > 0 ? `<span class="row-sub" style="grid-column:1/-1">Falta ${brl(c.falta)} para chegar ao ideal</span>` : ''}
      </div>`).join('')}</div>
    <p class="legend-note">Barra = participação atual · traço = participação ideal</p>
  </section>
  <section class="card">
    <h2>Ativos <small>${ativos.length}</small></h2>
    <div class="list">${ativos.map(a => `
      <div class="row">
        <div class="row-main">
          <span class="row-title">${esc(a.ativo)}</span>
          <span class="row-sub"><span class="badge">${esc(a.classe)}</span><span>${num(a.qtd)} × ${brl(a.atual)}</span></span>
        </div>
        <div class="row-side">
          <span class="row-val">${brl(a.saldo)}</span>
          <span class="row-val small ${sign(a.resultado)}">${a.resultado > 0 ? '+' : ''}${brl(a.resultado)} · ${pct(a.rentab, 2)}</span>
        </div>
      </div>`).join('')}</div>
  </section>
  <section class="card">
    <h2>Proventos <small>${brl(car.proventos_total)} no período</small></h2>
    ${prov.length ? `<div class="list">${prov.slice(0, 15).map(p => `
      <div class="row">
        <div class="row-main">
          <span class="row-title">${esc(p.ativo)} <span class="muted">· ${esc(p.tipo || '')}</span></span>
          <span class="row-sub"><span>${fmtDate(p.data)}</span>${p.status === 'A receber' ? '<span class="badge warn">A receber</span>' : '<span class="badge good">Pago</span>'}</span>
        </div>
        <div class="row-side"><span class="row-val">${brl(p.liquido)}</span></div>
      </div>`).join('')}</div>` : '<p class="empty">Nenhum provento lançado.</p>'}
  </section>`;
}

/* --- Imóvel --- */
function renderImovel(m, d) {
  const f = d.financiamento;
  const pagas = f.parcelas.filter(p => p.pago != null), abertas = f.parcelas.filter(p => p.pago == null);
  const prox = abertas[0];
  const pctPago = f.prazo ? f.pagas / f.prazo : 0;
  const rowP = p => `
    <div class="row ${p.origem === 'Projeção' ? 'muted' : ''}">
      <div class="row-main">
        <span class="row-title">Parcela ${p.n}</span>
        <span class="row-sub"><span>vence ${fmtDate(p.vencimento)}</span>${p.pago != null ? '<span class="badge good">Paga</span>' : p.origem === 'Projeção' ? '<span class="badge">Projeção</span>' : '<span class="badge accent">Em aberto</span>'}</span>
      </div>
      <div class="row-side">
        <span class="row-val">${brl(p.pago ?? p.total)}</span>
        ${p.pago != null && Math.abs(p.diferenca || 0) > 0.005 ? `<span class="row-val small">devido ${brl(p.total)}</span>` : ''}
      </div>
    </div>`;
  return `
  <section class="card">
    <div class="hero-label">Saldo devedor <span class="badge">em ${esc(f.saldo_em)}</span></div>
    <div class="hero-value">${brl(f.saldo_devedor)}</div>
    <div class="hero-sub"><b>${f.pagas}</b> de ${f.prazo} parcelas pagas · faltam <b>${f.remanescente}</b></div>
    <div class="meter"><div class="meter-fill" style="width:${pctPago * 100}%"></div></div>
    <div class="meter-label">${pct(pctPago)} do prazo cumprido</div>
  </section>
  <section class="kpis">
    ${prox ? tile('Próxima parcela', brl(prox.total), `nº ${prox.n} · vence ${fmtDate(prox.vencimento)}${prox.origem === 'Projeção' ? ' · projeção' : ''}`) : ''}
    ${tile('Juros nominais', pct(f.taxa, 1) + ' a.a.', esc(f.sistema || ''))}
  </section>
  <section class="card">
    <h2>Parcelas <small>em aberto e projeção</small></h2>
    <div class="list">${abertas.map(rowP).join('')}</div>
    ${pagas.length ? `<details><summary>Ver ${pagas.length} parcelas pagas</summary><div class="list">${pagas.map(rowP).join('')}</div></details>` : ''}
  </section>
  <section class="card">
    <h2>Contrato</h2>
    <dl class="stat-grid">
      <dt>Banco</dt><dd>Caixa</dd>
      <dt>Sistema</dt><dd>${esc(f.sistema || '')}</dd>
      <dt>Indexador</dt><dd>${esc(f.indexador || '')}</dd>
      <dt>Aumento médio por mês</dt><dd>${brl((f.aumento_aj || 0) + (f.aumento_seguro || 0))}</dd>
      <dt>Taxa de administração</dt><dd>${brl(f.adm)}</dd>
    </dl>
  </section>`;
}

/* --- Metas --- */
function renderMetas(m, d) {
  if (!d.metas.length) return '<section class="card"><p class="empty">Nenhuma meta cadastrada. Cadastre na aba Metas da planilha.</p></section>';
  return d.metas.map(g => `
  <section class="card">
    <h2>${esc(g.meta)} <small>${g.prazo ? 'até ' + fmtDate(g.prazo) : ''}</small></h2>
    <div class="hero-value mid">${brl(g.guardado)} <span class="unit">de ${brl(g.alvo)}</span></div>
    <div class="progress"><div style="width:${Math.min(100, (g.pct || 0) * 100)}%"></div></div>
    <dl class="stat-grid">
      <dt>Concluído</dt><dd>${pct(g.pct, 0)}</dd>
      <dt>Falta</dt><dd>${brl(g.falta)}</dd>
      ${g.meses ? `<dt>Meses restantes</dt><dd>${g.meses}</dd><dt>Aporte mensal necessário</dt><dd>${brl(g.aporte)}</dd>` : ''}
    </dl>
  </section>`).join('');
}

/* ---------- gráficos ---------- */
function mkChart(id, type, labels, datasets) {
  const el = document.getElementById(id);
  if (!el) return;
  const muted = css('--muted'), grid = css('--grid'), text2 = css('--text-2');
  datasets.forEach(ds => Object.assign(ds, type === 'bar'
    ? { borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 28, categoryPercentage: .62, barPercentage: .85 }
    : { borderColor: ds.backgroundColor, backgroundColor: 'transparent', borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: ds.backgroundColor, tension: .25 }));
  charts.push(new Chart(el, {
    type, data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: datasets.length > 1, position: 'bottom', labels: { color: text2, boxWidth: 8, boxHeight: 8, usePointStyle: true, padding: 14 } },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${brl(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, border: { color: grid }, ticks: { color: muted, font: { size: 11 } } },
        y: { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: muted, font: { size: 11 }, callback: v => compact(v) } },
      },
    },
  }));
}

function afterRender(m, d) {
  if (state.tab === 'resumo') {
    const ms = d.meses.filter(x => situacao(x) !== 'Previsto');
    mkChart('ch-meses', 'bar', ms.map(x => x.rotulo), [
      { label: 'Entradas', data: ms.map(x => x.entradas), backgroundColor: css('--accent') },
      { label: 'Saídas', data: ms.map(x => x.resumo.saidas), backgroundColor: css('--series-2') },
    ]);
  }
  if (state.tab === 'investir') {
    const ms = d.investimentos.mensal.filter(x => x.patrimonio > 0);
    mkChart('ch-patri', 'bar', ms.map(x => x.rotulo), [{ label: 'Patrimônio', data: ms.map(x => x.patrimonio), backgroundColor: css('--accent') }]);
    const h = d.investimentos.historico;
    if (h.length >= 2) mkChart('ch-hist', 'line', h.map(x => fmtDia(x.data)), [{ label: 'Total', data: h.map(x => x.total), backgroundColor: css('--accent') }]);
  }
}

/* ---------- eventos ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab],[data-mes],[data-sub],[data-cat]');
  if (!t || !state.dados) return;
  let toTop = false;
  if (t.dataset.tab) { state.tab = t.dataset.tab; toTop = true; }
  if (t.dataset.mes != null) { state.mes = +t.dataset.mes; state.cat = 'Todas'; renderMonths(); toTop = true; }
  if (t.dataset.sub) state.sub = t.dataset.sub;
  if (t.dataset.cat) state.cat = t.dataset.cat;
  render(toTop);
});

if (window.Chart) Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
init();
