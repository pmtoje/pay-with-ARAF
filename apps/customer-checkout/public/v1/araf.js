/*!
 * Pay with ARAF — embedded checkout SDK v1 (The Alternative Bank).
 *
 * Lets any website offer "Buy Now Pay Later with AltBank" without sending the shopper away:
 * the Bank-hosted checkout opens in a secure panel ON the merchant's page and closes back to it.
 *
 *   <script src="https://checkout.altbank.example/v1/araf.js"></script>
 *   ArafCheckout.button('#pay-later', { onClick: async () => {
 *     const { checkout_url } = await fetch('/your-server/create-araf-session', { method: 'POST' }).then(r => r.json());
 *     ArafCheckout.open({ checkoutUrl: checkout_url, onClose: (e) => location.reload() });
 *   }});
 *
 * Security model
 *  - The checkout session is created by YOUR SERVER with your secret key (never in the browser).
 *  - The panel only loads checkout URLs on the SDK's own origin, in a sandboxed iframe that cannot
 *    navigate your page. The Bank only allows framing by your approved website origins.
 *  - Messages are accepted only from the checkout origin and the panel's own window, and carry
 *    status only (no personal or credit data).
 *  - Events are hints for your UI. ALWAYS confirm status server-side (GET /api/v1/orders/{ref} or
 *    signed webhooks) before fulfilling. A closed panel or "complete" event is never proof of payment.
 */
(function () {
  'use strict';
  if (window.ArafCheckout) return;
  var script = document.currentScript;
  var ORIGIN = script ? new URL(script.src).origin : window.location.origin;
  var LABEL = 'Buy Now Pay Later with AltBank';
  var active = null;

  function css(el, styles) { for (var k in styles) el.style[k] = styles[k]; return el; }
  function h(tag, attrs, styles) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) el.setAttribute(k, attrs[k]);
    return css(el, styles || {});
  }

  /** Render the standard call-to-action button into a container (selector or element). */
  function button(target, opts) {
    opts = opts || {};
    var host = typeof target === 'string' ? document.querySelector(target) : target;
    if (!host) throw new Error('ArafCheckout.button: container not found');
    var b = h('button', { type: 'button', 'data-araf-button': '1' }, {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '10px', width: opts.block === false ? 'auto' : '100%',
      minHeight: '48px', padding: '0 20px', border: '0', borderRadius: '10px', cursor: 'pointer',
      background: opts.theme === 'gold' ? '#b08a2e' : '#0c0c0d', color: '#fff', font: '600 15px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    });
    var mark = h('span', { 'aria-hidden': 'true' }, { display: 'inline-grid', placeItems: 'center', width: '22px', height: '22px', borderRadius: '6px', background: '#b08a2e', color: '#0c0c0d', fontWeight: '800', fontSize: '13px' });
    mark.textContent = 'A';
    var text = h('span');
    text.textContent = opts.label || LABEL;
    b.appendChild(mark); b.appendChild(text);
    b.addEventListener('click', function (e) {
      if (b.getAttribute('aria-busy') === 'true') return;
      b.setAttribute('aria-busy', 'true'); b.style.opacity = '0.75';
      Promise.resolve(opts.onClick && opts.onClick(e)).catch(function (err) { if (opts.onError) opts.onError(err); else console.error(err); })
        .then(function () { b.removeAttribute('aria-busy'); b.style.opacity = '1'; });
    });
    host.appendChild(b);
    return b;
  }

  /** Open the checkout in a panel over the current page. Returns { close }. */
  function open(opts) {
    opts = opts || {};
    var url;
    try { url = new URL(opts.checkoutUrl, ORIGIN); } catch (e) { throw new Error('ArafCheckout.open: invalid checkoutUrl'); }
    if (url.origin !== ORIGIN || !/^\/c\/[A-Za-z0-9_]+/.test(url.pathname)) throw new Error('ArafCheckout.open: checkoutUrl must be a Pay with ARAF checkout URL on ' + ORIGIN);
    if (active) active.close('replaced');

    var opener = document.activeElement;
    var prevOverflow = document.documentElement.style.overflow;
    var small = window.matchMedia('(max-width: 640px)').matches;
    var overlay = h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Pay with ARAF — Buy Now Pay Later with AltBank' }, {
      position: 'fixed', inset: '0', zIndex: '2147483000', background: 'rgba(12,12,13,0.55)', display: 'flex', alignItems: small ? 'stretch' : 'center', justifyContent: 'center',
    });
    var panel = h('div', {}, {
      position: 'relative', background: '#faf9f6', overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,0.35)',
      width: small ? '100%' : 'min(520px, 96vw)', height: small ? '100%' : 'min(820px, 94vh)', borderRadius: small ? '0' : '16px',
    });
    var close = h('button', { type: 'button', 'aria-label': 'Close and return to the store' }, {
      position: 'absolute', top: '8px', right: '8px', zIndex: '2', width: '40px', height: '40px', borderRadius: '999px', border: '0', cursor: 'pointer',
      background: 'rgba(12,12,13,0.72)', color: '#fff', font: '600 18px/1 system-ui, sans-serif',
    });
    close.textContent = '✕';
    var frame = h('iframe', {
      src: url.toString(), title: 'Pay with ARAF secure checkout', allow: 'clipboard-write',
      // The checkout can never navigate or script the merchant page.
      sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads',
      referrerpolicy: 'origin',
    }, { width: '100%', height: '100%', border: '0', display: 'block' });
    panel.appendChild(frame); panel.appendChild(close); overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.documentElement.style.overflow = 'hidden';
    setTimeout(function () { try { frame.focus(); } catch (e) { /* ignore */ } }, 50);

    function emit(name, data) { try { if (opts.onEvent) opts.onEvent(Object.assign({ type: name }, data || {})); } catch (e) { console.error(e); } }
    function onMessage(ev) {
      if (ev.origin !== ORIGIN || ev.source !== frame.contentWindow) return;
      var d = ev.data;
      if (!d || d.source !== 'araf-checkout' || typeof d.type !== 'string') return;
      emit(d.type, d);
      if (d.type === 'araf:ready') hello();
      if (d.type === 'araf:complete' && opts.onComplete) { try { opts.onComplete(d); } catch (e) { console.error(e); } }
      if (d.type === 'araf:close') ctrl.close(d.reason || 'customer');
    }
    function hello() {
      // Tells the checkout which page embeds it; the checkout checks this against approved origins.
      try { frame.contentWindow.postMessage({ source: 'araf-merchant', type: 'araf:hello', version: 1 }, ORIGIN); } catch (e) { /* ignore */ }
    }
    function onKey(ev) { if (ev.key === 'Escape') ctrl.close('escape'); }
    frame.addEventListener('load', hello);
    window.addEventListener('message', onMessage);
    document.addEventListener('keydown', onKey);
    close.addEventListener('click', function () { ctrl.close('customer'); });

    var closed = false;
    var ctrl = {
      close: function (reason) {
        if (closed) return; closed = true;
        window.removeEventListener('message', onMessage);
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        document.documentElement.style.overflow = prevOverflow;
        if (opener && opener.focus) try { opener.focus(); } catch (e) { /* ignore */ }
        active = null;
        emit('araf:closed', { reason: reason });
        if (opts.onClose) try { opts.onClose({ reason: reason }); } catch (e) { console.error(e); }
      },
    };
    active = ctrl;
    emit('araf:opened');
    return ctrl;
  }

  window.ArafCheckout = { version: '1.0.0', origin: ORIGIN, label: LABEL, open: open, button: button };
})();
