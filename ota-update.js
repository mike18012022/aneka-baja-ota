/*
 * Auto OTA live-update for Aneka Baja (via @capgo/capacitor-updater).
 *
 * Update files are hosted on a public GitHub repo (mirror of the already-public
 * front-end). On EVERY app open and on every resume to foreground, the app:
 *   1. marks the running bundle as good (notifyAppReady) so it is never rolled back,
 *   2. reads the manifest,
 *   3. if a newer version exists, downloads it and applies it:
 *        - on cold open  -> applied immediately (set) so the update shows right away,
 *        - on resume      -> staged for next open (next) to avoid interrupting work.
 * A short toast confirms when an update is installed.
 *
 * Publish an update: run tools/make-ota-bundle.ps1 then push ota-dist/* to the
 * public OTA repo (handled by the developer). Only web content updates this way;
 * native changes (icon, permissions, plugins) still need a new APK.
 */
(function () {
  'use strict';

  var MANIFEST_URL = 'https://raw.githubusercontent.com/mike18012022/aneka-baja-ota/main/latest.json';

  function isNative() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }
  if (!isNative()) return;

  function plugins() { return (window.Capacitor && window.Capacitor.Plugins) || {}; }
  function toast(msg) {
    var T = plugins().Toast;
    if (T) { T.show({ text: msg, duration: 'short' }).catch(function () {}); }
  }
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  var checking = false;

  function checkAndApply(immediate) {
    var U = plugins().CapacitorUpdater;
    if (!U || checking) return;
    checking = true;

    fetch(MANIFEST_URL, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (info) {
        if (!info || !info.version || !info.url) return;
        return U.current().then(function (cur) {
          var curVer = (cur && cur.bundle && cur.bundle.version) || '';
          if (info.version === curVer) return; // already up to date
          return U.download({ version: info.version, url: info.url }).then(function (b) {
            if (!b || !b.id) return;
            if (immediate) {
              toast('Update ' + info.version + ' dipasang');
              return U.set({ id: b.id }); // reload into the new bundle now
            }
            toast('Update ' + info.version + ' siap (buka ulang untuk menerapkan)');
            return U.next ? U.next({ id: b.id }) : U.set({ id: b.id });
          });
        });
      })
      .catch(function () { /* offline / no manifest — ignore */ })
      .then(function () { checking = false; }, function () { checking = false; });
  }

  ready(function () {
    var U = plugins().CapacitorUpdater;
    if (U && U.notifyAppReady) { U.notifyAppReady().catch(function () {}); }

    // Check on cold open (apply immediately).
    checkAndApply(true);

    // Check again whenever the app returns to the foreground (stage for next open).
    var App = plugins().App;
    if (App && App.addListener) {
      App.addListener('resume', function () { checkAndApply(false); });
    }
  });
})();
