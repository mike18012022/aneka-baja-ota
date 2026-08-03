/*
 * Capacitor native bridge shims for Aneka Baja Sales.
 * Injected into the bundled web app (index.html) so the existing web code
 * keeps working unchanged inside the Android WebView:
 *   1. navigator.geolocation  -> routed through @capacitor/geolocation
 *   2. blob:/data: <a download> clicks -> saved to storage via @capacitor/filesystem
 * The web app itself is not modified beyond the API base (const PB) rewrite.
 */
(function () {
  'use strict';

  function plugins() {
    return (window.Capacitor && window.Capacitor.Plugins) ? window.Capacitor.Plugins : null;
  }
  function isNative() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }
  function toast(msg) {
    var P = plugins();
    if (P && P.Toast) { P.Toast.show({ text: msg, duration: 'long' }).catch(function () {}); }
    else { try { console.log('[toast]', msg); } catch (e) {} }
  }

  /* ---------- Geolocation: use the Capacitor plugin instead of WebView GPS ---------- */
  function installGeo() {
    var P = plugins();
    if (!P || !P.Geolocation || !navigator.geolocation) return false;
    var G = P.Geolocation;
    var watchMap = {};
    var counter = 0;

    navigator.geolocation.getCurrentPosition = function (success, error, options) {
      options = options || {};
      G.getCurrentPosition({
        enableHighAccuracy: options.enableHighAccuracy !== false,
        timeout: options.timeout || 15000,
        maximumAge: options.maximumAge || 0
      }).then(function (pos) {
        if (success) success({ coords: pos.coords, timestamp: pos.timestamp });
      }).catch(function (e) {
        if (error) error({ code: 1, message: (e && e.message) || String(e), PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      });
    };

    navigator.geolocation.watchPosition = function (success, error, options) {
      options = options || {};
      var localId = ++counter;
      G.watchPosition({
        enableHighAccuracy: options.enableHighAccuracy !== false,
        timeout: options.timeout || 15000
      }, function (pos, err) {
        if (err) { if (error) error({ code: 2, message: String(err) }); return; }
        if (pos && success) success({ coords: pos.coords, timestamp: pos.timestamp });
      }).then(function (id) { watchMap[localId] = id; });
      return localId;
    };

    navigator.geolocation.clearWatch = function (localId) {
      var id = watchMap[localId];
      if (id) { G.clearWatch({ id: id }); delete watchMap[localId]; }
    };

    // Ask for the OS location permission up front so the first capture is smooth.
    if (G.requestPermissions) { G.requestPermissions().catch(function () {}); }
    return true;
  }

  /* ---------- Downloads: save blob:/data: downloads to device storage ---------- */
  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onerror = reject;
      r.onload = function () {
        var s = String(r.result);
        resolve(s.slice(s.indexOf(',') + 1));
      };
      r.readAsDataURL(blob);
    });
  }

  function saveDownload(href, filename) {
    var P = plugins();
    var FS = P && P.Filesystem;
    if (!FS) { toast('Gagal menyimpan: Filesystem tidak tersedia'); return; }
    var name = (filename || ('download-' + Date.now())).replace(/[\\/:*?"<>|]/g, '_');

    fetch(href).then(function (r) { return r.blob(); }).then(function (blob) {
      return blobToBase64(blob);
    }).then(function (data) {
      // Try the public Documents folder first (visible in Files app),
      // fall back to the app's external folder if scoped storage blocks it.
      return FS.writeFile({ path: name, data: data, directory: 'DOCUMENTS', recursive: true })
        .then(function () { toast('Tersimpan di Documents/' + name); })
        .catch(function () {
          return FS.writeFile({ path: name, data: data, directory: 'EXTERNAL', recursive: true })
            .then(function () { toast('Tersimpan di folder aplikasi: ' + name); });
        });
    }).catch(function (e) {
      toast('Gagal menyimpan file: ' + ((e && e.message) || e));
    });
  }

  function installDownload() {
    var proto = HTMLAnchorElement.prototype;
    if (proto.__capDownloadPatched) return true;
    var origClick = proto.click;
    proto.click = function () {
      try {
        var dl = this.getAttribute && this.getAttribute('download');
        var href = this.href || '';
        if (dl !== null && dl !== undefined && dl !== false &&
            (href.indexOf('blob:') === 0 || href.indexOf('data:') === 0)) {
          saveDownload(href, typeof dl === 'string' && dl ? dl : this.getAttribute('download'));
          return;
        }
      } catch (e) {}
      return origClick.apply(this, arguments);
    };
    proto.__capDownloadPatched = true;
    return true;
  }

  /* ---------- Status bar: reserve space so content isn't hidden under it ---------- */
  function installStatusBar() {
    var P = plugins();
    if (!P || !P.StatusBar) return false;
    try {
      // Do not draw the web view behind the status bar (fixes top being cut off).
      P.StatusBar.setOverlaysWebView({ overlay: false });
      // Match the app's dark top bar, with light icons/text.
      P.StatusBar.setBackgroundColor({ color: '#10141B' });
      P.StatusBar.setStyle({ style: 'DARK' });
      return true;
    } catch (e) { return false; }
  }

  ready(function () {
    if (!isNative()) return; // in a normal browser, leave everything untouched
    installDownload();
    var geoDone = false, sbDone = false, tries = 0;
    var t = setInterval(function () {
      tries++;
      if (!geoDone) geoDone = installGeo();
      if (!sbDone) sbDone = installStatusBar();
      if ((geoDone && sbDone) || tries > 50) clearInterval(t);
    }, 100);
  });
})();
