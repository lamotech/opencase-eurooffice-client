// Small UI helpers shared by Dokument info and Gem i OpenCase: elements,
// buttons and dialogs shown over the panel (see resources/styles/panel.css).
(function (window) {
  function element(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function button(text, className, onClick) {
    var b = element("button", className || "button small", text);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }

  // Shows a dialog over the panel. build(box, close) fills it.
  function openDialog(title, build) {
    var overlay = element("div", "overlay");
    var box = element("div", "dialog");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", title);
    box.appendChild(element("h4", null, title));
    overlay.appendChild(box);
    function close() {
      overlay.remove();
    }
    overlay.addEventListener("keydown", function (event) {
      if (event.key === "Escape") close();
    });
    build(box, close);
    document.body.appendChild(overlay);
    var first = box.querySelector("input, select, [contenteditable], button");
    if (first) first.focus();
    return close;
  }

  // Resolves true when the user confirms.
  function confirmDialog(title, message, okText) {
    return new Promise(function (resolve) {
      openDialog(title, function (box, close) {
        box.appendChild(element("p", null, message));
        var buttons = element("div", "buttons");
        buttons.appendChild(button("Annuller", "button", function () { close(); resolve(false); }));
        buttons.appendChild(button(okText || "OK", "button primary", function () { close(); resolve(true); }));
        box.appendChild(buttons);
      });
    });
  }

  // A labelled control in a dialog; returns the control.
  function field(box, labelText, control, hint) {
    var wrap = element("div", "field");
    var label = element("label", null, labelText);
    control.id = control.id || "f-" + Math.random().toString(36).slice(2);
    label.htmlFor = control.id;
    wrap.appendChild(label);
    wrap.appendChild(control);
    box.appendChild(wrap);
    if (hint) box.appendChild(element("div", "hint", hint));
    return control;
  }

  function input(type) {
    var el = document.createElement("input");
    el.type = type || "text";
    el.autocomplete = "off";
    return el;
  }

  window.OpenCasePanel = {
    element: element,
    button: button,
    openDialog: openDialog,
    confirmDialog: confirmDialog,
    field: field,
    input: input
  };
})(window);
