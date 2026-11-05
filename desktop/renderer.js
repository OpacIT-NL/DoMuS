const status = document.querySelector("#status");
document.querySelector("#choose").onclick = async () => {
  try {
    document.querySelector("#share").textContent =
      await window.domus.chooseShare();
  } catch (e) {
    status.textContent = e.message;
  }
};
document.querySelector("#connect").onsubmit = async (e) => {
  e.preventDefault();
  try {
    status.textContent = await window.domus.connect(
      Object.fromEntries(new FormData(e.target)),
    );
    e.target.ticket.value = "";
  } catch (e) {
    status.textContent = e.message;
  }
};
window.domus.status((value) => {
  status.textContent = value;
});
