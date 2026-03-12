/* Minimal RequireJS CSS loader plugin for PCI runtime. */
define(function () {
  "use strict";

  var head = document.getElementsByTagName("head")[0];

  function normalize(name) {
    if (!name) return name;
    return name.endsWith(".css") ? name : name + ".css";
  }

  return {
    load: function (name, req, onload) {
      try {
        var url = req.toUrl(normalize(name));
        var link = document.createElement("link");
        link.type = "text/css";
        link.rel = "stylesheet";
        link.href = url;
        link.onload = function () {
          onload();
        };
        link.onerror = function () {
          if (onload && typeof onload.error === "function") {
            onload.error(new Error("Failed to load CSS: " + url));
          } else {
            onload();
          }
        };
        head.appendChild(link);
      } catch (err) {
        if (onload && typeof onload.error === "function") {
          onload.error(err);
        } else {
          onload();
        }
      }
    },
  };
});
