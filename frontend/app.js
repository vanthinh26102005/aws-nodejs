const api = window.DEMO_API_URL.replace(/\/$/, '');
const connection = document.querySelector('#connection');
const connectionText = document.querySelector('#connection-text');
const message = document.querySelector('#response-message');
const json = document.querySelector('#response-json');
const checkButton = document.querySelector('#check-button');
const sendButton = document.querySelector('#send-button');
const sendLabel = document.querySelector('#send-label');

document.querySelector('#api-url').textContent = api;
document.querySelector('#environment-note').textContent = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? 'Local: frontend và backend đang chạy cùng máy.'
  : 'Frontend gọi trực tiếp API qua HTTPS.';

function setConnection(state, text) {
  connection.dataset.state = state;
  connectionText.textContent = text;
}

async function request(path, options = {}) {
  const start = performance.now();
  let response;
  try {
    response = await fetch(`${api}${path}`, { ...options, signal: AbortSignal.timeout(8000) });
  } catch {
    setConnection('offline', 'Chưa kết nối được API');
    document.querySelector('#response-timing').textContent = 'Lỗi kết nối';
    json.textContent = JSON.stringify({ error: 'Không nhận được phản hồi từ API.' }, null, 2);
    throw new Error('Không kết nối được API. Kiểm tra địa chỉ API, HTTPS và cấu hình CORS.');
  }
  const data = await response.json();
  document.querySelector('#response-timing').textContent = `${response.status} · ${Math.round(performance.now() - start)} ms`;
  json.textContent = JSON.stringify(data, null, 2);
  if (!response.ok) throw new Error(data.error || 'API không xử lý được request.');
  return data;
}

async function checkConnection() {
  checkButton.disabled = true;
  sendButton.disabled = true;
  setConnection('checking', 'Đang kiểm tra…');
  document.querySelector('#request-label').textContent = 'GET /api/health';
  document.querySelector('#response-timing').textContent = '…';
  json.textContent = 'Đang chờ API…';
  try {
    const data = await request('/api/health');
    setConnection('connected', 'API đã kết nối');
    message.textContent = `Backend đang hoạt động với Node.js ${data.nodeVersion}. Sẵn sàng nhận lời chào của bạn.`;
    document.querySelector('#last-check').textContent = `Đã kiểm tra lúc ${new Date().toLocaleTimeString('vi-VN')}`;
  } catch (error) {
    setConnection('offline', 'Chưa kết nối được API');
    message.textContent = error.message;
    document.querySelector('#last-check').textContent = 'Kiểm tra chưa thành công.';
  } finally {
    checkButton.disabled = false;
    sendButton.disabled = false;
  }
}

checkButton.addEventListener('click', checkConnection);
document.querySelector('#greeting-form').addEventListener('submit', async event => {
  event.preventDefault();
  const name = document.querySelector('#name');
  if (!name.value.trim()) {
    name.setCustomValidity('Hãy nhập tên của bạn.');
    name.reportValidity();
    return;
  }
  sendButton.disabled = true;
  checkButton.disabled = true;
  sendLabel.textContent = 'Đang gửi…';
  document.querySelector('#greeting-form').setAttribute('aria-busy', 'true');
  document.querySelector('#request-label').textContent = 'POST /api/greet';
  document.querySelector('#response-timing').textContent = '…';
  message.textContent = 'Đang chờ phản hồi từ backend…';
  json.textContent = 'Đang chờ API…';
  try {
    const data = await request('/api/greet', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.value.trim() }),
    });
    setConnection('connected', 'API đã kết nối');
    message.textContent = data.message;
  } catch (error) {
    message.textContent = error.message;
  } finally {
    sendButton.disabled = false;
    checkButton.disabled = false;
    sendLabel.textContent = 'Gửi lời chào';
    document.querySelector('#greeting-form').removeAttribute('aria-busy');
  }
});
document.querySelector('#name').addEventListener('input', event => event.target.setCustomValidity(''));
checkConnection();
