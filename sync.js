/* =============================================================
   W1nner → CRM Gihad Azanki · script de sincronização (v2)
   Roda dentro do W1nner clássico (w1nner.w1consultoria.com.br) usando a
   sessão já aberta. Só LÊ dados; não altera nada no W1nner.
   Entrega os dados ao CRM por postMessage; o CRM grava no Firebase com o
   login Google do consultor.
   Coleta: dashboard, contatos + funil, contratos (próprios e herdados, com
   plano de parcelas e PPs), extrato de comissões e resultados por período.
   ============================================================= */
(function () {
  'use strict';
  var VERSION = '2.0.0';
  var SELF = document.currentScript && document.currentScript.src;
  var CRM_URL = window.W1SYNC_CRM_URL || (SELF ? new URL('./', SELF).href : 'https://gihadazankiw1-gif.github.io/crm-gihadazanki/');
  var CRM_ORIGIN = new URL(CRM_URL).origin;
  var W1_HOST = 'w1nner.w1consultoria.com.br';
  var TEST = !!window.__w1syncTestOnly;

  if (window.__w1syncRunning) { alert('A sincronização já está em andamento.'); return; }
  if (location.host !== W1_HOST) {
    alert('Para sincronizar, use o W1nner clássico. Vou te levar até lá: quando a página carregar, clique no favorito de novo.');
    location.href = 'https://' + W1_HOST + '/painel-consultor/dashboard';
    return;
  }
  window.__w1syncRunning = true;

  // ---------- caixa de progresso ----------
  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;width:330px;background:#000;color:#fff;border:2px solid #FFD500;border-radius:14px;padding:16px 18px;font:13px/1.5 Montserrat,Arial,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.6)';
  box.innerHTML = '<div style="font-weight:900;color:#FFD500;margin-bottom:6px;">Sincronizando com o CRM</div><div id="w1s-msg">Iniciando...</div><div style="height:4px;background:#262626;border-radius:2px;margin-top:10px;overflow:hidden;"><div id="w1s-bar" style="height:100%;width:2%;background:#FFD500;transition:width .3s;"></div></div><div id="w1s-x" style="margin-top:10px;display:none;text-align:right;"><button style="background:#FFD500;border:none;border-radius:8px;padding:6px 14px;font-weight:800;cursor:pointer;">Fechar</button></div>';
  if (!TEST) document.body.appendChild(box);
  function msg(t, pct) { var m = document.getElementById('w1s-msg'), b = document.getElementById('w1s-bar'); if (m) m.innerHTML = t; if (b && pct != null) b.style.width = pct + '%'; }
  function finish(t, ok) {
    msg(t, 100);
    var b = document.getElementById('w1s-bar'); if (b) b.style.background = ok ? '#059669' : '#dc2626';
    var x = document.getElementById('w1s-x'); if (x) { x.style.display = 'block'; x.querySelector('button').onclick = function () { box.remove(); }; }
    window.__w1syncRunning = false;
  }

  // Abre o CRM já no clique (evita bloqueio de pop-up)
  var popup = TEST ? null : window.open(CRM_URL + '#w1sync', 'crm_w1sync');

  // ---------- helpers ----------
  var H_HTML = { credentials: 'include', headers: { 'Accept': 'text/html' } };
  var H_JSON = { credentials: 'include', headers: { 'Accept': 'application/json' } };
  var H_XHR = { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'text/javascript, application/json, */*' } };
  function parse(html) { return new DOMParser().parseFromString(html, 'text/html'); }
  function getText(url, h) { return fetch(url, h || H_HTML).then(function (r) { if (!r.ok) throw new Error(url.split('?')[0] + ' → ' + r.status); return r.text(); }); }
  function getDoc(url) { return getText(url).then(parse); }
  function getJSON(url) { return fetch(url, H_JSON).then(function (r) { if (!r.ok) throw new Error(url.split('?')[0] + ' → ' + r.status); return r.json(); }); }
  function txt(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }
  function brl(s) { s = (s || '').replace(/\s/g, ''); if (!/\d/.test(s)) return null; var neg = /-/.test(s); var n = parseFloat(s.replace(/[^\d,]/g, '').replace(',', '.')); return isNaN(n) ? null : (neg ? -n : n); }
  function num(s) { s = (s || '').replace(/R\$|\s/g, ''); if (!/\d/.test(s)) return 0; if (s.indexOf(',') > -1) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0; return parseFloat(s) || 0; }
  function dateBR(s) { var m = (s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; }
  function fmtBR(d) { return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); }
  function idFrom(s, re) { var m = (s || '').match(re); return m ? m[1] : null; }
  // Respostas "text/javascript" do W1nner: $("#x").replaceWith('<html…>') → extrai o HTML
  function unJS(t) {
    var a = t.indexOf("replaceWith('"); if (a < 0) a = t.indexOf(".html('"); if (a < 0) return t;
    var s = t.slice(t.indexOf("('", a) + 2); var b = s.lastIndexOf("')");
    return s.slice(0, b).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\//g, '/').replace(/\\\\/g, '\\');
  }
  // Serializa um formulário como o jQuery faria, a partir do HTML estático
  function formParams(form) {
    var p = new URLSearchParams();
    Array.prototype.forEach.call(form.querySelectorAll('input[name],select[name],textarea[name]'), function (e) {
      var t = (e.getAttribute('type') || '').toLowerCase();
      if (t === 'submit' || t === 'button') return;
      if (t === 'checkbox' || t === 'radio') { if (e.hasAttribute('checked')) p.append(e.name, e.getAttribute('value') || 'on'); return; }
      if (e.tagName === 'SELECT') {
        var sel = Array.prototype.filter.call(e.options, function (o) { return o.hasAttribute('selected'); });
        if (!sel.length && e.options.length && !e.multiple) sel = [e.options[0]];
        sel.forEach(function (o) { p.append(e.name, o.getAttribute('value') != null ? o.getAttribute('value') : o.textContent); });
        return;
      }
      p.append(e.name, e.getAttribute('value') || e.value || '');
    });
    return p;
  }

  // ---------- coletores ----------
  function getConsultant() {
    return getDoc('/painel-consultor/dashboard').then(function (doc) {
      var id = idFrom(doc.documentElement.innerHTML, /\/painel-consultor\/equipe\/(\d+)/);
      var heads = Array.prototype.map.call(doc.querySelectorAll('h1,h2,h3,h4,h5'), txt).filter(Boolean);
      var stats = {};
      for (var i = 1; i < heads.length; i++) { if (/^[\d\.,]+$/.test(heads[i - 1])) stats[heads[i]] = heads[i - 1]; }
      return { id: id, nome: heads[1] || '', stats: {
        contatos: num(stats['Contatos'] || '0'), contratos: num(stats['Contratos'] || '0'),
        ppsHistoricos: parseFloat(stats["PP's Históricos"] || '0') || 0, ppsTrimestre: parseFloat(stats["PP's no Trimestre"] || '0') || 0
      } };
    });
  }

  function getContacts(cid) {
    var base = 'https://' + W1_HOST + '/api/consultant/contacts?search[s]=created_at%20desc&search[structure][consultant_id]=' + cid + '&search[structure][type]=only_consultant&page=';
    var all = [];
    function page(p) {
      return getJSON(base + p).then(function (j) {
        (j.contacts || []).forEach(function (c) {
          all.push({ id: c.id, nome: c.name || '', status: c.salesFlowStatus || '', criado: (c.createdAt || '').slice(0, 10),
            diasStatus: c.daysInCurrentSalesFlowStatus || 0, indicadoPor: (c.indicatedBy && c.indicatedBy.name) || '',
            celular: c.cellphone || '', renda: c.monthlyIncome || '' });
        });
        var tp = (j.meta && j.meta.totalPages) || 1;
        msg('Contatos: ' + all.length + ' de ' + ((j.meta && j.meta.totalCount) || '?'), 4 + Math.round(p / tp * 20));
        return p < tp ? page(p + 1) : all;
      });
    }
    return page(1);
  }

  function getStatusReport(cid) {
    return getJSON('https://' + W1_HOST + '/api/consultant/contacts/status_report?search[s]=created_at%20desc&search[structure][consultant_id]=' + cid + '&search[structure][type]=only_consultant')
      .then(function (j) { return (j.statuses || []).map(function (s) { return { status: s.status.value, label: s.status.label, total: s.totalCount }; }); })
      .catch(function () { return []; });
  }

  // Contratos (Centro Econômico → Contratos). type 'only_consultant' = os seus; '' = todos sob sua responsabilidade (inclui herdados)
  function getContracts(cid) {
    return getDoc('/painel-consultor/propostas-de-produto').then(function (doc) {
      var form = doc.querySelector('#new_search'); if (!form) throw new Error('Formulário de contratos não encontrado');
      var base = formParams(form);
      function list(type, consultant) {
        var out = [], seen = {};
        function page(p) {
          var q = new URLSearchParams(base.toString());
          q.set('search[by_structure_type][type]', type); q.set('search[by_structure_type][consultant_id]', consultant);
          q.set('search[page_elements]', '100'); if (p > 1) q.set('page', String(p));
          return getText('/painel-consultor/propostas-de-produto/list?' + q.toString(), H_XHR).then(function (t) {
            var d = parse(unJS(t)); var tb = d.querySelector('table'); if (!tb) return out;
            var heads = Array.prototype.map.call(tb.querySelectorAll('thead th'), txt);
            var ix = function (h) { return heads.indexOf(h); };
            var novos = 0;
            Array.prototype.forEach.call(tb.querySelectorAll('tbody > tr'), function (tr) {
              var c = tr.children; if (c.length < heads.length - 1) return;
              var id = txt(c[0]); if (!id || seen[id]) return; seen[id] = 1; novos++;
              var apc = c[ix('AP / Parcelas')];
              var parcelas = apc ? Array.prototype.map.call(apc.querySelectorAll('.ap-installment-popover-item'), function (it) {
                return { n: parseInt(txt(it.querySelector('.ap-installment-popover-item-number')), 10) || 0,
                         data: dateBR(txt(it.querySelector('.ap-installment-popover-item-date'))),
                         valor: brl(txt(it.querySelector('.ap-installment-popover-item-value'))) || 0,
                         pago: it.classList.contains('ap-installment-popover-item--paid') };
              }) : [];
              out.push({ id: id, status: txt(c[ix('Status')]), diasStatus: num(txt(c[ix('Dias no Status')])),
                assinatura: dateBR(txt(c[ix('Data da Assinatura')])), cliente: txt(c[ix('Cliente')]),
                parceira: txt(c[ix('Parceira')]), produto: txt(c[ix('Produto')]),
                valor: apc ? (brl(txt(apc.querySelector('.ap-installment-cell-value') || apc)) || 0) : 0,
                parcelas: parcelas, pps: num(txt(c[ix('PPs')])) });
            });
            return (novos >= 100 && p < 10) ? page(p + 1) : out;
          });
        }
        return page(1);
      }
      msg('Contratos (seus)...', 27);
      return list('only_consultant', cid).then(function (proprios) {
        msg('Contratos (herdados)...', 33);
        return list('', '').then(function (todos) {
          var ids = {}; proprios.forEach(function (c) { ids[c.id] = 1; });
          todos.forEach(function (c) { c.origem = ids[c.id] ? 'proprio' : 'herdado'; });
          proprios.forEach(function (c) { if (!todos.some(function (t) { return t.id === c.id; })) { c.origem = 'proprio'; todos.push(c); } });
          return todos;
        });
      });
    });
  }

  function getCommissions() {
    return getDoc('/painel-consultor/minhas-comissoes').then(function (doc) {
      var ids = [];
      Array.prototype.forEach.call(doc.querySelectorAll('a[href*="minhas-comissoes?company_id="]'), function (a) {
        var id = idFrom(a.getAttribute('href'), /company_id=(\d+)/);
        if (id && !ids.some(function (x) { return x.id === id; })) ids.push({ id: id, empresa: txt(a) });
      });
      var out = [], ci = 0;
      function company() {
        if (ci >= ids.length) return out;
        var co = ids[ci++], seen = {};
        function page(p) {
          msg('Comissões · ' + co.empresa + ' · página ' + p, 40 + Math.round(ci / ids.length * 40));
          return getDoc('/painel-consultor/minhas-comissoes/commissions_received?company_id=' + co.id + '&page=' + p).then(function (d) {
            var novos = 0;
            Array.prototype.forEach.call(d.querySelectorAll('table tbody tr'), function (tr) {
              var c = tr.children; if (c.length < 8) return;
              var id = txt(c[0]); if (!id || seen[id]) return; seen[id] = 1; novos++;
              var valor = null;
              for (var k = 6; k < Math.min(c.length, 14); k++) { if (/R\$/.test(txt(c[k]))) { valor = brl(txt(c[k])); break; } }
              out.push({ id: id, empresaId: co.id, empresa: co.empresa, data: dateBR(txt(c[1])), tipo: txt(c[2]),
                produto: txt(c[3]), contato: txt(c[4]), parcela: txt(c[5]), valor: valor, obs: txt(c[c.length - 1]) });
            });
            return (novos > 0 && p < 80) ? page(p + 1) : null;
          }).catch(function () { return null; });
        }
        return page(1).then(company);
      }
      return company();
    });
  }

  function getResults(cid) {
    return getDoc('/painel-consultor/centro-de-economia').then(function (doc) {
      var f = doc.querySelector('form.economy_center'); if (!f) return { semanas: [], meses: [] };
      var base = new URLSearchParams();
      Array.prototype.forEach.call(f.querySelectorAll('[name]'), function (e) {
        if (e.name === 'button' || e.name === 'select_all') return;
        if (e.type === 'checkbox' || e.type === 'radio') { if (/offices/.test(e.name)) base.append(e.name, e.value); return; }
        base.append(e.name, e.value);
      });
      base.set('economy_center[structure][type]', 'only_consultant'); base.set('economy_center[structure][consultant_id]', cid);
      var keys = { scheduled_analyses: 'aa', performed_analyses: 'af', analyses_paid: 'ap', analysis_paid_value: 'apValor', leads: 'recs', pps_period: 'pps' };
      function period(ini, fim) {
        var p = new URLSearchParams(base.toString());
        p.set('economy_center[start_date]', fmtBR(ini)); p.set('economy_center[end_date]', fmtBR(fim));
        return getText('/painel-consultor/centro-de-economia/render_economy_center_node_row?' + p.toString() + '&consultants_id=' + cid, H_XHR).then(function (t) {
          t = t.replace(/\\"/g, '"').replace(/\\\//g, '/');
          var o = { inicio: ini.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) };
          Object.keys(keys).forEach(function (k) { var m = t.match(new RegExp('js-total_' + k + '"[^>]*>([^<]*)<')); o[keys[k]] = m ? (k === 'analysis_paid_value' ? (brl(m[1]) || 0) : num(m[1])) : 0; });
          return o;
        }).catch(function () { return null; });
      }
      var hoje = new Date(); hoje.setHours(12, 0, 0, 0);
      var seg = new Date(hoje); seg.setDate(seg.getDate() - ((seg.getDay() + 6) % 7));
      var jobs = [];
      for (var w = 0; w < 8; w++) { var a = new Date(seg); a.setDate(a.getDate() - 7 * w); var b = new Date(a); b.setDate(b.getDate() + 6); jobs.push(['s', a, b]); }
      for (var m = 0; m < 6; m++) { jobs.push(['m', new Date(hoje.getFullYear(), hoje.getMonth() - m, 1, 12), new Date(hoje.getFullYear(), hoje.getMonth() - m + 1, 0, 12)]); }
      var res = { semanas: [], meses: [] }, j = 0;
      function next() {
        if (j >= jobs.length) return res;
        var job = jobs[j++]; msg('Resultados: ' + j + ' de ' + jobs.length, 82 + Math.round(j / jobs.length * 13));
        return period(job[1], job[2]).then(function (o) { if (o) (job[0] === 's' ? res.semanas : res.meses).push(o); }).then(next);
      }
      return next();
    }).catch(function () { return { semanas: [], meses: [] }; });
  }

  // ---------- envio para o CRM ----------
  function sendToCRM(payload) {
    return new Promise(function (resolve, reject) {
      var done = false, sent = false, timer, ping;
      function stop() { done = true; clearTimeout(timer); clearInterval(ping); window.removeEventListener('message', onMsg); }
      function onMsg(e) {
        if (e.origin !== CRM_ORIGIN || !e.data) return;
        if (e.data.type === 'crm-ready' && !sent) { sent = true; msg('Entregando ao CRM...', 97); popup.postMessage({ type: 'w1nner-sync', payload: payload }, CRM_ORIGIN); }
        if (e.data.type === 'crm-saved') { stop(); resolve(e.data); }
        if (e.data.type === 'crm-error') { stop(); reject(new Error(e.data.message || 'erro no CRM')); }
      }
      window.addEventListener('message', onMsg);
      ping = setInterval(function () { if (done) return; try { popup.postMessage({ type: 'w1nner-hello' }, CRM_ORIGIN); } catch (_) {} }, 1500);
      timer = setTimeout(function () { if (!done) { stop(); reject(new Error('O CRM não respondeu. Faça login nele com o Google e clique no favorito de novo.')); } }, 180000);
    });
  }

  // ---------- execução ----------
  var payload = { versao: VERSION, sincronizadoEm: new Date().toISOString() };
  window.__w1syncCollect = function () {
    return getConsultant().then(function (c) {
      if (!c.id) throw new Error('Não encontrei seu ID de consultor. Você está logado no W1nner?');
      payload.consultorId = c.id; payload.consultorNome = c.nome; payload.dashboard = c.stats;
      return getContacts(c.id);
    }).then(function (x) { payload.contatos = x; return getStatusReport(payload.consultorId); })
      .then(function (x) { payload.statusReport = x; return getContracts(payload.consultorId); })
      .then(function (x) { payload.contratos = x; return getCommissions(); })
      .then(function (x) { payload.comissoes = x; return getResults(payload.consultorId); })
      .then(function (x) { payload.resultados = x; return payload; });
  };
  if (TEST) { window.__w1syncRunning = false; return; }
  if (!popup) { finish('O navegador bloqueou a janela do CRM. Permita pop-ups para o W1nner e clique no favorito de novo.', false); return; }

  window.__w1syncCollect().then(function (p) {
    msg('Abrindo o CRM... (se pedir, faça login com o Google)', 96);
    return sendToCRM(p);
  }).then(function (r) { finish('✅ Pronto! ' + (r.resumo || 'Dados enviados ao CRM.'), true); })
    .catch(function (e) { console.error('[W1 Sync]', e); finish('❌ ' + (e && e.message ? e.message : 'Algo deu errado.'), false); });
})();
