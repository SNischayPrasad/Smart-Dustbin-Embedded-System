/* ==========================================================================
   user-admin.js - the owner-only user management console
   --------------------------------------------------------------------------
   WHAT THIS CAN AND CANNOT DO

   The site is static, so there is no database and no API to POST to. This
   page therefore does two separate things, and is careful not to blur them:

     1. It edits an in-memory copy of the registry, so a change takes effect
        immediately in this browser and can be demonstrated.
     2. It generates the exact users.js content to commit, which is what
        makes the change real for everyone else.

   The in-memory copy is deliberately NOT persisted. Writing roles into
   localStorage would mean anyone could grant themselves ownership from
   DevTools and have it stick, turning a documented limitation into an actual
   back door. Reload and you are back to the committed registry - the file on
   disk stays the single source of truth.
   ========================================================================== */
(function () {

  const session = AUTH.currentSession();
  if (!session || !Users.can(session.role, "canManageUsers")) return;

  /* Defined here rather than pulled in from data.js: that file is the fleet
     layer and this page has no business loading it just for one helper. */
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }

  document.getElementById("whoami").textContent =
    session.name + " (" + Users.roleLabel(session.role) + ")";
  document.getElementById("footUser").textContent = session.username;

  document.getElementById("logoutBtn").addEventListener("click", function () {
    AUTH.logout();
    window.location.href = "login.html";
  });

  const toastEl = document.getElementById("toast");
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2600);
  }

  /* ---- working copy ---------------------------------------------------- */
  const COMMITTED = USER_DB.USERS.map(function (u) { return Object.assign({}, u); });
  let working     = USER_DB.USERS.map(function (u) { return Object.assign({}, u); });
  let dirty       = false;

  function apply() {
    USER_DB.USERS = working.map(function (u) { return Object.assign({}, u); });
    render();
  }

  function countRole(r) {
    return working.filter(function (u) { return u.role === r; }).length;
  }

  /* ---- rendering ------------------------------------------------------- */
  function render() {
    document.getElementById("userRows").innerHTML = working.map(function (u, i) {
      const digest = u.emailHash
        ? "<code style='font-size:12px'>" + u.emailHash.slice(0, 12) + "&hellip;</code>"
        : "<span class='muted'>plain: " + escapeHtml(u.email) + "</span>";
      const manages = Users.can(u.role, "canManageUsers");
      const lastOwner = u.role === "owner" && countRole("owner") === 1;
      const badge = u.role === "owner" ? "full" : (u.role === "admin" ? "ok" : "offline");

      return "<tr>" +
        "<td><b>" + escapeHtml(u.name) + "</b></td>" +
        "<td><span class='badge badge-" + badge + "'><span class='dot'></span>" +
          Users.roleLabel(u.role) + "</span></td>" +
        "<td>" + digest + "</td>" +
        "<td>" + (manages ? "yes" : "no") + "</td>" +
        "<td>" + (lastOwner
          ? "<span class='muted'>last owner</span>"
          : "<button class='btn btn-sm btn-danger' data-remove='" + i + "'>Remove</button>") +
        "</td></tr>";
    }).join("");

    document.getElementById("regSummary").textContent =
      countRole("owner") + " owner, " + countRole("admin") + " admin, " +
      countRole("viewer") + " viewer";

    Array.prototype.forEach.call(document.querySelectorAll("[data-remove]"), function (b) {
      b.addEventListener("click", function () {
        const i = parseInt(b.getAttribute("data-remove"), 10);
        const who = working[i];
        if (!confirm("Remove " + who.name + " from the registry?")) return;
        working.splice(i, 1);
        dirty = true;
        apply();
        toast(who.name + " removed - commit users.js to make it stick");
      });
    });

    document.getElementById("pendingNote").textContent = dirty
      ? "Unsaved changes in this browser. Commit the generated file to publish them."
      : "No changes yet.";

    document.getElementById("generated").textContent = generated();
  }

  /* ---- the file to commit ---------------------------------------------- */
  function generated() {
    const body = working.map(function (u) {
      const key = u.emailHash
        ? '{ emailHash: "' + u.emailHash + '",'
        : '{ email: "' + u.email + '",';
      return "    " + key + "\n      name: \"" + u.name + "\", role: \"" + u.role + "\" }";
    }).join(",\n\n");
    return "  USERS: [\n" + body + "\n  ],";
  }

  /* ---- add someone ------------------------------------------------------ */
  const errBox = document.getElementById("addError");
  function showError(msg) { errBox.textContent = msg; errBox.classList.add("show"); }

  document.getElementById("addBtn").addEventListener("click", async function () {
    errBox.classList.remove("show");

    const email = document.getElementById("newEmail").value.trim();
    const name  = document.getElementById("newName").value.trim();
    const role  = document.getElementById("newRole").value;

    if (!email || email.indexOf("@") < 1 || email.indexOf(".") === -1) {
      return showError("That does not look like an email address.");
    }
    if (!name) {
      return showError("Give them a display name, so the registry stays readable.");
    }

    const hash = await Users.sha256Hex(Users.normalise(email));

    const clash = working.some(function (u) {
      return (u.emailHash || "").toLowerCase() === hash ||
             (u.email && Users.normalise(u.email) === Users.normalise(email));
    });
    if (clash) return showError("That address is already in the registry.");

    working.push({ emailHash: hash, name: name, role: role });
    dirty = true;
    apply();

    document.getElementById("newEmail").value = "";
    document.getElementById("newName").value  = "";
    toast(name + " added as " + Users.roleLabel(role) + " - now commit users.js");
  });

  /* ---- standalone hasher ------------------------------------------------ */
  document.getElementById("hashBtn").addEventListener("click", async function () {
    const v = document.getElementById("hashInput").value.trim();
    const out = document.getElementById("hashOut");
    if (!v) { out.textContent = "Enter an address first."; return; }
    const h = await Users.sha256Hex(Users.normalise(v));
    out.textContent = h + "\n\n{ emailHash: \"" + h + "\",\n  name: \"Their Name\", role: \"admin\" }";
  });

  /* ---- copy, download, revert ------------------------------------------- */
  document.getElementById("copyBtn").addEventListener("click", async function () {
    try {
      await navigator.clipboard.writeText(generated());
      toast("Copied. Paste it over the USERS array in users.js");
    } catch (e) {
      toast("Clipboard blocked - select the text and copy manually");
    }
  });

  document.getElementById("downloadBtn").addEventListener("click", function () {
    const blob = new Blob([generated()], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "users-array.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById("revertBtn").addEventListener("click", function () {
    working = COMMITTED.map(function (u) { return Object.assign({}, u); });
    dirty = false;
    apply();
    toast("Reverted to the committed registry");
  });

  render();
})();
