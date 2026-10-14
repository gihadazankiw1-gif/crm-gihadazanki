/* =============================================================
   W1nner → CRM Gihad Azanki · script de sincronização
   Roda dentro do W1nner (w1nner.w1consultoria.com.br), usando a
   sessão já aberta do consultor. Só LÊ dados; não altera nada no W1nner.
   Os dados são entregues ao CRM por postMessage; o CRM grava no
   Firebase com o login Google do próprio consultor.
   ============================================================= */
(function () {
  'use strict';
  var VERSION = '1.0.0';
  // O CRM fica no mesmo endereço de onde este script foi carregado (ex.: seu GitHub Pages)
  var SELF = document.currentScript && document.currentScript.src;
  var CRM_URL = window.W1SYNC_CRM_URL || (SELF ? new URL('./', SELF).href : 'https://gihadazankiw1-gif.github.io/crm-gihadazanki/');
  var CRM_ORIGIN = new URL(CRM_URL).origin;
  var W1_HOST = 'w1nner.w1consultoria.com.br';

  if (window.__w1syncRunning) { alert('A sincronização já está em andamento.'); return; }

  if (location.host !== W1_HOST) {
    alert('Para sincronizar, abra o W1nner "clássico". Vou te levar até lá: depois que a página carregar, clique no favorito de novo.');
    location.href = 'https://' + W1_HOST + '/painel-consultor/dashboard';
    return;
  }
  window.__w1syncRunning = true;

  // ---------- UI ----------
  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;width:330px;background:#000;color:#fff;border:2px solid #FFD500;border-radius:14px;padding:16px 18px;font:13px/1.5 Montserrat,Arial,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.6)';
  box.innerHTML = '<div style="font-weight:900;color:#FFD500;margin-bottom:6px;">⚡ Sincronizando com o CRM</div><div id="w1s-msg">Iniciando...</div><div style="height:4px;background:#262626;border-radius:2px;margin-top:10px;overflow:hidden;"><div id="w1s-bar" style="height:100%;width:2%;background:#FFD500;transition:width .3s;"></div></div><div id="w1s-x" style="margin-top:10px;display:none;text-align:right;"><button style="background:#FFD500;border:none;border-radius:8px;padding:6px 14px;font-weight:800;cursor:pointer;">Fechar</button></div>';
  document.body.appendChild(box);
  var msg = function (t, pct) { var m = document.getElementById('w1s-msg'), b = document.getElementById('w1s-bar'); if (m) m.innerHTML = t; if (b && pct != null) b.style.width = pct + '%'; };
  var finish = function (t, ok) {
    msg(t, 100);
    document.getElementById('w1s-bar').style.background = ok ? '#059669' : '#dc2626';
    var x = document.getElementById('w1s-x'); x.style.display = 'block';
    x.querySelector('button').onclick = function () { box.remove(); };
    window.__w1syncRunning = false;
  };

  // Abre o CRM já no clique (evita bloqueio de pop-up)
  var popup = window.__w1syncTestOnly ? null : window.open(CRM_URL + '#w1sync', 'crm_w1sync');

  // ---------- helpers ----------
  var H_HTML = { credentials: 'include', headers: { 'Accept': 'text/html' } };
  var H_JSON = { credentials: 'include', headers: { 'Accept': 'application/json' } };
  var H_XHR = { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'text/javascript, application/json, */*' } };
  function getDoc(url) { return fetch(url, H_HTML).then(function (r) { if (!r.ok) throw new Error(url + ' → ' + r.status); return r.text(); }).then(function (t) { return new DOMParser().parseFromString(t, 'text/html'); }); }
  function getJSON(url) { return fetch(url, H_JSON).then(function (r) { if (!r.ok) throw new Error(url + ' → ' + r.status); return r.json(); }); }
  function txt(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }
  function brl(s) { // "R$ 1.234,56" | "-R$ 0,60" | "R$ -0,60" → número
    s = (s || '').replace(/\s/g, ''); if (!/\d/.test(s)) return null;
    var neg = /-/.test(s); var n = parseFloat(s.replace(/[^\d,]/g, '').replace(',', '.'));
    return isNaN(n) ? null : (neg ? -n : n);
  }
  function num(s) { // "11.6526" (decimal com ponto) ou "1.234" / "2.000,50"
    s = (s || '').replace(/R\$|\s/g, ''); if (!/\d/.test(s)) return 0;
    if (s.indexOf(',') > -1) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
    return parseFloat(s) || 0;
  }
  function dateBR(s) { var m = (s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; }
  function fmtBR(d) { return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); }
  function idFrom(href, re) { var m = (href || '').match(re); return m ? m[1] : null; }

  // ---------- coletores ----------
  function getConsultant() {
    return getDoc('/painel-consultor/dashboard').then(function (doc) {
      var html = doc.documentElement.innerHTML;
      var id = idFrom(html, /\/painel-consultor\/equipe\/(\d+)/);
      var heads = Array.prototype.map.call(doc.querySelectorAll('h1,h2,h3,h4,h5'), txt).filter(Boolean);
      var stats = {};
      for (var i = 1; i < heads.length; i++) {
        if (/^[\d\.,]+$/.test(heads[i - 1])) stats[heads[i]] = heads[i - 1];
      }
      return { id: id, stats: {
        contatos: num(stats['Contatos'] || '0'),
        contratos: num(stats['Contratos'] || '0'),
        ppsHistoricos: parseFloat((stats["PP's Históricos"] || '0')) || 0,
        ppsTrimestre: parseFloat((stats["PP's no Trimestre"] || '0')) || 0
      } };
    });
  }

  function getContacts(cid) {
    var base = 'https://' + W1_HOST + '/api/consultant/contacts?search[s]=created_at%20desc&search[structure][consultant_id]=' + cid + '&search[structure][type]=only_consultant&page=';
    var all = [];
    function page(p) {
      return getJSON(base + p).then(function (j) {
        (j.contacts || []).forEach(function (c) {
          all.push({
            id: c.id, nome: c.name || '', status: c.salesFlowStatus || '',
            criado: (c.createdAt || '').slice(0, 10), atualizado: (c.updatedAt || '').slice(0, 10),
            diasStatus: c.daysInCurrentSalesFlowStatus || 0,
            indicadoPor: (c.indicatedBy && c.indicatedBy.name) || '',
            celular: c.cellphone || '', renda: c.monthlyIncome || '',
            quente: c.hotColdStatus || '', clienteId: (c.client && c.client.id) || null
          });
        });
        var tp = (j.meta && j.meta.totalPages) || 1;
        msg('Contatos: ' + all.length + ' de ' + ((j.meta && j.meta.totalCount) || '?'), 5 + Math.round(p / tp * 25));
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

  function getSubscriptions() {
    var subs = [], seen = {};
    function listPage(p) {
      return getDoc('/painel-consultor/assinaturas?page=' + p).then(function (doc) {
        var rows = doc.querySelectorAll('table tbody tr'), novos = 0;
        Array.prototype.forEach.call(rows, function (tr) {
          var c = tr.children; if (c.length < 7) return;
          var id = txt(c[0]); if (seen[id]) return; seen[id] = 1; novos++;
          var link = tr.querySelector('a[href*="/contatos/"]');
          var det = tr.querySelector('a[href*="/assinaturas/"]');
          subs.push({
            id: id, cliente: txt(c[1]), contatoId: link ? idFrom(link.getAttribute('href'), /contatos\/(\d+)/) : null,
            inicio: dateBR(txt(c[2])), termino: dateBR(txt(c[3])), categoria: txt(c[4]),
            cobranca: txt(c[5]), situacao: txt(c[6]), detalhe: det ? det.getAttribute('href') : null
          });
        });
        var hasNext = !!doc.querySelector('.pagination a[rel="next"], .pagination .next a');
        return (novos > 0 && hasNext && p < 30) ? listPage(p + 1) : subs;
      });
    }
    return listPage(1).then(function () {
      // Detalhe das consultorias (valor e parcelamento da AP)
      var cons = subs.filter(function (s) { return /consultoria/i.test(s.categoria) && s.detalhe; });
      var i = 0;
      function next() {
        if (i >= cons.length) return subs;
        var s = cons[i++];
        msg('Consultorias (AP): ' + i + ' de ' + cons.length, 32 + Math.round(i / cons.length * 13));
        return getDoc(s.detalhe).then(function (doc) {
          s.cobrancas = Array.prototype.map.call(doc.querySelectorAll('table tbody tr'), function (tr) {
            var c = tr.children; var forma = txt(c[4]);
            return { envio: dateBR(txt(c[1])), atualizado: dateBR(txt(c[2])), valor: brl(txt(c[3])), forma: forma,
                     parcelas: parseInt((forma.match(/(\d+)x/) || [0, 1])[1], 10), situacao: txt(c[5]) };
          });
        }).catch(function () { s.cobrancas = []; }).then(next);
      }
      return next();
    }).then(function () { subs.forEach(function (s) { delete s.detalhe; }); return subs; });
  }

  function getCommissions() {
    return getDoc('/painel-consultor/minhas-comissoes').then(function (doc) {
      var ids = [];
      Array.prototype.forEach.call(doc.querySelectorAll('a[href*="minhas-comissoes?company_id="]'), function (a) {
        var id = idFrom(a.getAttribute('href'), /company_id=(\d+)/); var nome = txt(a);
        if (id && !ids.some(function (x) { return x.id === id; })) ids.push({ id: id, empresa: nome });
      });
      var out = [], ci = 0;
      function company() {
        if (ci >= ids.length) return out;
        var co = ids[ci++], seen = {};
        function page(p) {
          msg('Comissões · ' + co.empresa + ' · página ' + p, 45 + Math.round(ci / ids.length * 35));
          return getDoc('/painel-consultor/minhas-comissoes/commissions_received?company_id=' + co.id + '&page=' + p).then(function (d) {
            var rows = d.querySelectorAll('table tbody tr'), novos = 0;
            Array.prototype.forEach.call(rows, function (tr) {
              var c = tr.children; if (c.length < 8) return;
              var id = txt(c[0]); if (!id || seen[id]) return; seen[id] = 1; novos++;
              var valor = null;
              for (var k = 6; k < Math.min(c.length, 14); k++) { if (/R\$/.test(txt(c[k]))) { valor = brl(txt(c[k])); break; } }
              out.push({ id: id, empresaId: co.id, empresa: co.empresa, data: dateBR(txt(c[1])), tipo: txt(c[2]),
                         produto: txt(c[3]), contato: txt(c[4]), parcela: txt(c[5]), valor: valor,
                         obs: txt(c[c.length - 1]) });
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
      base.set('economy_center[structure][type]', 'only_consultant');
      base.set('economy_center[structure][consultant_id]', cid);
      var keys = { scheduled_analyses: 'aa', performed_analyses: 'af', analyses_paid: 'ap', analysis_paid_value: 'apValor',
                   leads: 'recs', consultings: 'consultorias', clients: 'clientes', consulting_pps: 'ppsConsultoria',
                   service_pps: 'ppsServicos', pps_period: 'ppsPeriodo', pps_sum: 'ppsTotal' };
      function period(ini, fim) {
        var p = new URLSearchParams(base.toString());
        p.set('economy_center[start_date]', fmtBR(ini)); p.set('economy_center[end_date]', fmtBR(fim));
        return fetch('/painel-consultor/centro-de-economia/render_economy_center_node_row?' + p.toString() + '&consultants_id=' + cid, H_XHR)
          .then(function (r) { return r.text(); }).then(function (t) {
            t = t.replace(/\\"/g, '"').replace(/\\\//g, '/');
            var o = { inicio: ini.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) };
            Object.keys(keys).forEach(function (k) {
              var m = t.match(new RegExp('js-total_' + k + '"[^>]*>([^<]*)<'));
              o[keys[k]] = m ? (k === 'analysis_paid_value' ? (brl(m[1]) || 0) : num(m[1])) : 0;
            });
            return o;
          }).catch(function () { return null; });
      }
      var hoje = new Date(); hoje.setHours(12, 0, 0, 0);
      var seg = new Date(hoje); seg.setDate(seg.getDate() - ((seg.getDay() + 6) % 7));
      var jobs = [];
      for (var w = 0; w < 8; w++) { var a = new Date(seg); a.setDate(a.getDate() - 7 * w); var b = new Date(a); b.setDate(b.getDate() + 6); jobs.push(['s', a, b]); }
      for (var m = 0; m < 6; m++) { var ma = new Date(hoje.getFullYear(), hoje.getMonth() - m, 1, 12); var mb = new Date(hoje.getFullYear(), hoje.getMonth() - m + 1, 0, 12); jobs.push(['m', ma, mb]); }
      var res = { semanas: [], meses: [] }, j = 0;
      function next() {
        if (j >= jobs.length) return res;
        var job = jobs[j++]; msg('Resultados do Centro Econômico: ' + j + ' de ' + jobs.length, 80 + Math.round(j / jobs.length * 15));
        return period(job[1], job[2]).then(function (o) { if (o) (job[0] === 's' ? res.semanas : res.meses).push(o); }).then(next);
      }
      return next();
    }).catch(function () { return { semanas: [], meses: [] }; });
  }

  // ---------- envio para o CRM ----------
  function sendToCRM(payload) {
    return new Promise(function (resolve, reject) {
      var done = false, sent = false, timer;
      function onMsg(e) {
        if (e.origin !== CRM_ORIGIN || !e.data) return;
        if (e.data.type === 'crm-ready' && !done && !sent) {
          sent = true;
          msg('Entregando ao CRM...', 97);
          popup.postMessage({ type: 'w1nner-sync', payload: payload }, CRM_ORIGIN);
        }
        if (e.data.type === 'crm-saved') { done = true; clearTimeout(timer); window.removeEventListener('message', onMsg); resolve(e.data); }
        if (e.data.type === 'crm-error') { done = true; clearTimeout(timer); window.removeEventListener('message', onMsg); reject(new Error(e.data.message || 'erro no CRM')); }
      }
      window.addEventListener('message', onMsg);
      // pede ao CRM para avisar quando estiver pronto (caso ele já tenha carregado antes)
      var ping = setInterval(function () { if (done) return clearInterval(ping); try { popup.postMessage({ type: 'w1nner-hello' }, CRM_ORIGIN); } catch (_) {} }, 1500);
      timer = setTimeout(function () { clearInterval(ping); if (!done) { window.removeEventListener('message', onMsg); reject(new Error('O CRM não respondeu. Verifique se você fez login nele com o Google e clique no favorito de novo.')); } }, 180000);
    });
  }

  // ---------- execução ----------
  var payload = { versao: VERSION, sincronizadoEm: new Date().toISOString() };
  window.__w1syncCollect = function () { // usado também para testes
    return getConsultant().then(function (c) {
      if (!c.id) throw new Error('Não encontrei seu ID de consultor no W1nner. Você está logado?');
      payload.consultorId = c.id; payload.dashboard = c.stats;
      return getContacts(c.id);
    }).then(function (contatos) { payload.contatos = contatos; return getStatusReport(payload.consultorId); })
      .then(function (st) { payload.statusReport = st; msg('Assinaturas (AP e FUP)...', 31); return getSubscriptions(); })
      .then(function (subs) { payload.assinaturas = subs; return getCommissions(); })
      .then(function (com) { payload.comissoes = com; return getResults(payload.consultorId); })
      .then(function (res) { payload.resultados = res; return payload; });
  };
  if (window.__w1syncTestOnly) { window.__w1syncRunning = false; box.remove(); return; }

  if (!popup) { finish('O navegador bloqueou a janela do CRM. Permita pop-ups para o W1nner e clique no favorito de novo.', false); return; }

  window.__w1syncCollect().then(function (p) {
    msg('Abrindo o CRM... (se pedir, faça login com o Google)', 96);
    return sendToCRM(p);
  }).then(function (r) {
    finish('✅ Pronto! ' + (r.resumo || 'Dados enviados ao CRM.'), true);
  }).catch(function (e) {
    console.error('[W1 Sync]', e);
    finish('❌ ' + (e && e.message ? e.message : 'Algo deu errado.'), false);
  });
})();
