const api = window.DEMO_API_URL.replace(/\/$/, "");
const connection = document.querySelector("#connection");
const connectionText = document.querySelector("#connection-text");
const message = document.querySelector("#response-message");
const json = document.querySelector("#response-json");
const checkButton = document.querySelector("#check-button");
const sendButton = document.querySelector("#send-button");
const sendLabel = document.querySelector("#send-label");

document.querySelector("#api-url").textContent = api;
document.querySelector("#environment-note").textContent = [
  "localhost",
  "127.0.0.1",
].includes(location.hostname)
  ? "Local: frontend và backend đang chạy cùng máy."
  : "Frontend gọi trực tiếp API qua HTTPS.";

function setConnection(state, text) {
  connection.dataset.state = state;
  connectionText.textContent = text;
}

async function request(path, options = {}) {
  const start = performance.now();
  const label = `${options.method || "GET"} ${path.split("?")[0]}`;
  let response;
  try {
    response = await fetch(`${api}${path}`, {
      ...options,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    document.querySelector("#request-label").textContent = label;
    setConnection("offline", "Chưa kết nối được API");
    document.querySelector("#response-timing").textContent = "Lỗi kết nối";
    json.textContent = JSON.stringify(
      { error: "Không nhận được phản hồi từ API." },
      null,
      2,
    );
    throw new Error(
      "Không kết nối được API. Kiểm tra địa chỉ API, HTTPS và cấu hình CORS.",
    );
  }
  const data = await response.json();
  document.querySelector("#request-label").textContent = label;
  document.querySelector("#response-timing").textContent =
    `${response.status} · ${Math.round(performance.now() - start)} ms`;
  json.textContent = JSON.stringify(data, null, 2);
  if (!response.ok)
    throw new Error(data.error || "API không xử lý được request.");
  return data;
}

async function checkConnection() {
  checkButton.disabled = true;
  sendButton.disabled = true;
  setConnection("checking", "Đang kiểm tra…");
  document.querySelector("#request-label").textContent = "GET /api/health";
  document.querySelector("#response-timing").textContent = "…";
  json.textContent = "Đang chờ API…";
  try {
    const data = await request("/api/health");
    setConnection("connected", "API đã kết nối");
    message.textContent = `Backend đang hoạt động với Node.js ${data.nodeVersion}. Sẵn sàng nhận lời chào của bạn.`;
    document.querySelector("#last-check").textContent =
      `Đã kiểm tra lúc ${new Date().toLocaleTimeString("vi-VN")}`;
  } catch (error) {
    setConnection("offline", "Chưa kết nối được API");
    message.textContent = error.message;
    document.querySelector("#last-check").textContent =
      "Kiểm tra chưa thành công.";
  } finally {
    checkButton.disabled = false;
    sendButton.disabled = false;
  }
}

checkButton.addEventListener("click", checkConnection);
document
  .querySelector("#greeting-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.querySelector("#name");
    if (!name.value.trim()) {
      name.setCustomValidity("Hãy nhập tên của bạn.");
      name.reportValidity();
      return;
    }
    sendButton.disabled = true;
    checkButton.disabled = true;
    sendLabel.textContent = "Đang gửi…";
    document.querySelector("#greeting-form").setAttribute("aria-busy", "true");
    document.querySelector("#request-label").textContent = "POST /api/greet";
    document.querySelector("#response-timing").textContent = "…";
    message.textContent = "Đang chờ phản hồi từ backend…";
    json.textContent = "Đang chờ API…";
    try {
      const data = await request("/api/greet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.value.trim() }),
      });
      setConnection("connected", "API đã kết nối");
      message.textContent = data.message;
    } catch (error) {
      message.textContent = error.message;
    } finally {
      sendButton.disabled = false;
      checkButton.disabled = false;
      sendLabel.textContent = "Gửi lời chào";
      document.querySelector("#greeting-form").removeAttribute("aria-busy");
    }
  });
document
  .querySelector("#name")
  .addEventListener("input", (event) => event.target.setCustomValidity(""));

const filesButton = document.querySelector("#files-button");
const filesStatus = document.querySelector("#files-status");
const filesList = document.querySelector("#files-list");

filesButton.addEventListener("click", async () => {
  filesButton.disabled = true;
  filesList.replaceChildren();
  filesStatus.textContent = "Đang tải file từ S3…";
  document.querySelector("#request-label").textContent = "GET /api/files";
  try {
    const data = await request("/api/files");
    filesStatus.textContent = data.files.length
      ? `Đã tải ${data.files.length} file.${data.truncated ? " Chỉ hiển thị trang đầu, tối đa 10 file." : ""}`
      : "Chưa có file mẫu trong demo/.";
    message.textContent = "Backend đã đọc danh sách file từ S3.";
    for (const file of data.files) {
      const row = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = `${file.key} (${file.size} byte)`;
      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.textContent = "Mở file";
      openButton.setAttribute("aria-label", `Mở file ${file.key}`);
      const link = document.createElement("a");
      link.textContent = "Link tải (5 phút)";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.hidden = true;
      openButton.addEventListener("click", async () => {
        // Open during the click so the browser does not block an async popup.
        const tab = window.open("about:blank", "_blank");
        if (tab) tab.opener = null;
        openButton.disabled = true;
        link.hidden = true;
        filesStatus.textContent = "Đang tạo link mở file…";
        document.querySelector("#request-label").textContent =
          "GET /api/files/download";
        try {
          const data = await request(
            `/api/files/download?${new URLSearchParams({ key: file.key })}`,
          );
          link.href = data.url;
          link.hidden = false;
          filesStatus.textContent = `Link ${file.key} có hiệu lực 5 phút. Nếu tab mới không mở, bấm Link tải.`;
          message.textContent =
            "Backend tạo link có chữ ký; trình duyệt tải file trực tiếp từ S3.";
          if (tab) tab.location.replace(data.url);
        } catch (error) {
          if (tab) tab.close();
          filesStatus.textContent = error.message;
          message.textContent = error.message;
        } finally {
          openButton.disabled = false;
        }
      });
      row.append(name, openButton, link);
      filesList.append(row);
    }
  } catch (error) {
    filesStatus.textContent = error.message;
    message.textContent = error.message;
  } finally {
    filesButton.disabled = false;
  }
});
checkConnection();
