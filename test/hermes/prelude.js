// The little React Native provides to a script that Hermes' bare CLI lacks.
var console = { log: print, error: print, warn: print, info: print, debug: print };
var __DEV__ = false; var global = globalThis; globalThis.self = globalThis; globalThis.window = globalThis;
globalThis.process = { env: { NODE_ENV: "production" } };
globalThis.TextEncoder = function () {}; TextEncoder.prototype.encode = function (s) { var a = []; s = unescape(encodeURIComponent(String(s))); for (var i = 0; i < s.length; i++) a.push(s.charCodeAt(i)); return new Uint8Array(a); };
globalThis.TextDecoder = function () {}; TextDecoder.prototype.decode = function (b) { var s = ""; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return decodeURIComponent(escape(s)); };
