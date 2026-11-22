// Calls the site-api backend (FastAPI on a home server, exposed via
// Tailscale Funnel). window.SITE_API_BASE comes from site._data/site.json
// (`apiBase`) via an inline script on the page.
(function () {
  const form = document.getElementById("echo-form");
  const input = document.getElementById("echo-input");
  const statusEl = document.getElementById("echo-status");
  const resultEl = document.getElementById("echo-result");
  const apiBase = window.SITE_API_BASE;

  if (!apiBase) {
    statusEl.textContent =
      "Backend not configured yet — set apiBase in src/_data/site.json to your Tailscale Funnel URL.";
    form.querySelector("button").disabled = true;
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    statusEl.textContent = "Sending…";
    resultEl.textContent = "";

    try {
      const res = await fetch(apiBase + "/echo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input.value }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      statusEl.textContent = "Got a response:";
      resultEl.textContent = JSON.stringify(data, null, 2);
    } catch (err) {
      statusEl.textContent = `Request failed (${err.message}). Is the home server / Tailscale Funnel up?`;
    }
  });
})();
