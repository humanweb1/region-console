const MANUAL_VALUE = "__manual__";
const SELECT_TO_INPUT = {
  drawCountry: "drawNewCountry",
  drawProvince: "drawNewProvince",
  drawDistrict: "drawNewDistrict",
  drawNeighborhood: "drawNewNeighborhood"
};

function reveal(select) {
  const inputId = SELECT_TO_INPUT[select?.id];
  if (!inputId) return;
  const input = document.getElementById(inputId);
  const wrap = document.getElementById(`${inputId}Wrap`);
  if (!input || !wrap) return;
  wrap.hidden = false;
  wrap.style.display = "flex";
  input.required = true;
}

function conceal(select) {
  const inputId = SELECT_TO_INPUT[select?.id];
  if (!inputId) return;
  const input = document.getElementById(inputId);
  const wrap = document.getElementById(`${inputId}Wrap`);
  if (!input || !wrap) return;
  wrap.hidden = true;
  wrap.style.display = "none";
  input.required = false;
}

function enforce(select) {
  if (!select?.isConnected) return;
  if (select.dataset.manualChoice === "1") {
    const manualOption = [...select.options].find((option) => option.value === MANUAL_VALUE);
    if (!manualOption) {
      select.insertAdjacentHTML("beforeend", `<option value="${MANUAL_VALUE}">＋ Yeni ekle</option>`);
    }
    select.value = MANUAL_VALUE;
    reveal(select);
  } else if (select.value !== MANUAL_VALUE) {
    conceal(select);
  }
}

document.addEventListener("change", (event) => {
  const select = event.target?.closest?.("select");
  if (!select || !SELECT_TO_INPUT[select.id]) return;
  if (select.value === MANUAL_VALUE) {
    select.dataset.manualChoice = "1";
    reveal(select);
    requestAnimationFrame(() => enforce(select));
    setTimeout(() => enforce(select), 0);
    setTimeout(() => enforce(select), 100);
    setTimeout(() => enforce(select), 500);
  } else {
    delete select.dataset.manualChoice;
    conceal(select);
  }
}, true);

document.addEventListener("click", (event) => {
  const button = event.target?.closest?.("[data-cancel-manual]");
  if (!button) return;
  const inputId = button.dataset.cancelManual;
  const input = document.getElementById(inputId);
  const wrap = document.getElementById(`${inputId}Wrap`);
  if (input) input.value = "";
  if (wrap) { wrap.hidden = true; wrap.style.display = "none"; }
  const selectId = Object.keys(SELECT_TO_INPUT).find((key) => SELECT_TO_INPUT[key] === inputId);
  const select = selectId ? document.getElementById(selectId) : null;
  if (select) { delete select.dataset.manualChoice; select.value = ""; }
}, true);

const observer = new MutationObserver(() => {
  for (const id of Object.keys(SELECT_TO_INPUT)) {
    const select = document.getElementById(id);
    if (select?.dataset.manualChoice === "1") enforce(select);
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });
