if (window.location.hostname === "store.steampowered.com") {
  function appendStyle(css) {
    return new Promise(function (resolve) {
      function insert() {
        var style = document.createElement("style");
        style.setAttribute("data-kzt-rub-converter", "style");
        style.textContent = css;
        document.head.appendChild(style);
        resolve();
      }

      if (document.head) {
        insert();
      } else {
        document.addEventListener("DOMContentLoaded", insert, { once: true });
      }
    });
  }

  Promise.all([
    import("./converter_config.js"),
    fetch(new URL("../../webkit/converter.css", import.meta.url))
      .then(function (response) {
        if (!response.ok) {
          throw new Error("failed to load converter.css: " + response.status);
        }
        return response.text();
      })
      .then(appendStyle)
  ])
    .then(function () {
      return import("../../webkit/converter.js");
    })
    .catch(function (error) {
      console.error("[kzt_rub_converter] WebKit loader failed", error);
    });
}
