# Artium Cloud Lab

Một folder để push lên một repo: backend Node.js trên EC2, frontend HTML/CSS/JS trên Vercel. Demo kiểm tra API và gửi tên để nhận lời chào. Không lưu tên, không có database, không cần npm install.

```text
cloud-services-demo/
├── package.json
├── backend/
│   ├── server.mjs
│   ├── check.mjs
│   └── .env.example
├── frontend/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── config.js
│   └── vercel.json
└── deploy/
    ├── Caddyfile
    └── cloud-demo.service
```

## Chạy trên Mac

Cần Node.js 24 trở lên. Trong folder `cloud-services-demo`:

```bash
npm start
```

Mở **http://localhost:3000**. Backend phục vụ cả frontend ở local để chỉ cần một Terminal. FE tự gọi API cùng origin khi chạy trên localhost; khi deploy FE, nó gọi `https://aws.artium.id.vn` theo `frontend/config.js`.

Nếu port 3000 đã được ứng dụng khác dùng:

```bash
PORT=3002 npm start
```

Mở **http://localhost:3002**. Khi chưa có `backend/.env`, backend tự cho phép các origin localhost của port đang dùng. Nếu đã tạo `.env`, đổi cả PORT và các origin local trong file đó.

```bash
npm run dev
npm test
```

`dev` tự khởi động lại backend khi code thay đổi; refresh trình duyệt để nhận FE mới. `test` dùng HTTP thật trên port tạm, kiểm tra API, JSON/tên sai, body quá lớn, CORS, method, đường dẫn và các asset frontend.

## API

| Endpoint | Request | Kết quả |
| --- | --- | --- |
| `GET /api/health` | Không có body | Trạng thái, phiên bản Node, uptime, timestamp |
| `POST /api/greet` | JSON `{"name":"Thịnh"}` | Lời chào và timestamp |

```bash
curl http://localhost:3000/api/health
curl -X POST http://localhost:3000/api/greet \
  -H 'Content-Type: application/json' \
  -d '{"name":"Thịnh"}'
```

Tên sau khi trim phải có 1–80 ký tự. Body tối đa 16 KiB. Sai dữ liệu trả 400, body quá lớn 413, sai Content-Type 415, sai method 405, sai đường dẫn 404. FE hiển thị phản hồi bằng text, không chèn nội dung người dùng thành HTML.

API này là demo công khai, không có tài khoản hoặc dữ liệu riêng tư. CORS giới hạn các origin frontend; CORS không phải xác thực và không chặn client như curl.

## Domain và nơi deploy

| Thành phần | Domain | Nơi deploy |
| --- | --- | --- |
| Backend | `aws.artium.id.vn` | EC2 Singapore, Elastic IP `18.141.47.152` |
| Frontend dự kiến | `demo.artium.id.vn` | Vercel |

`artium.id.vn`, `www` và `api` đã có cấu hình của dự án khác. Demo dùng subdomain mới. Bản ghi `aws` là A → `18.141.47.152`, bảo vệ/proxy tắt. Bản ghi `demo` sẽ lấy **đúng giá trị Vercel cung cấp** khi thêm custom domain; không sao chép IP Vercel từ dự án khác.

## Chạy backend trên EC2

Sau khi có repo, clone **nội dung folder này** vào `/home/ubuntu/cloud-services-demo`. Cấu hình systemd bên dưới dùng đường dẫn đó và NVM của user `ubuntu`.

Kết nối từ Mac:

```bash
ssh -i ~/Downloads/nodejs-learning-key.pem ubuntu@aws.artium.id.vn
```

Trong Terminal Ubuntu, sau khi clone:

```bash
cd ~/cloud-services-demo
cp backend/.env.example backend/.env
npm test
npm start
```

Nếu file `.env` đã tồn tại, sửa file hiện có để giữ cấu hình. Mở Terminal SSH thứ hai để kiểm tra:

```bash
curl http://127.0.0.1:3000/api/health
```

Sau khi chạy thử thành công, Ctrl+C ở Terminal đang chạy `npm start`, rồi bật service để backend tiếp tục chạy khi đóng SSH và tự chạy lại sau khi reboot:

```bash
sudo cp deploy/cloud-demo.service /etc/systemd/system/cloud-demo.service
sudo systemctl daemon-reload
sudo systemctl enable --now cloud-demo
sudo systemctl status cloud-demo --no-pager
curl http://127.0.0.1:3000/api/health
```

```bash
sudo journalctl -u cloud-demo -n 50 --no-pager
sudo systemctl restart cloud-demo
```

Backend chỉ bind `127.0.0.1`; không mở cổng 3000 ra internet. Caddy sẽ nhận request công khai và chuyển vào port này.

## HTTPS cho backend bằng Caddy

Trong **EC2 → instance → Security → security group → Edit inbound rules**, thêm **HTTP TCP 80** và **HTTPS TCP 443**, source `0.0.0.0/0`. Giữ SSH 22 giới hạn My IP. Nếu dùng UFW, cho phép 80/443 ở UFW nữa.

Cài Caddy theo [hướng dẫn chính thức cho Ubuntu](https://caddyserver.com/docs/install#debian-ubuntu-raspbian). Sau khi Caddy đã cài, từ folder repo trên EC2:

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl https://aws.artium.id.vn/api/health
```

Lệnh copy trên dùng cho máy demo mới. Nếu máy đã có Caddy phục vụ website khác, thêm block từ `deploy/Caddyfile` vào cấu hình hiện có.

Caddy tự cấp và gia hạn chứng chỉ khi DNS đúng và port 80/443 truy cập được. Xem [Caddy HTTPS quick-start](https://caddyserver.com/docs/quick-starts/https). FE trên HTTPS cần API HTTPS để trình duyệt không chặn mixed content.

## Deploy frontend lên Vercel

Push **toàn bộ nội dung folder `cloud-services-demo`** thành một repo. Khi import repo vào Vercel:

| Setting | Giá trị |
| --- | --- |
| Root Directory | `frontend` |
| Framework Preset | `Other` |
| Build Command | Để trống; bật Override nếu cần |
| Output Directory | `.` |

`frontend/vercel.json` đã khai báo static project. FE không có build step hoặc dependency. Chọn Root Directory `frontend` để các file backend và `.env` không nằm trong nội dung public. Xem [Vercel Root Directory và static build](https://vercel.com/docs/builds/configure-a-build) và [monorepo](https://vercel.com/docs/monorepos).

Trong Vercel project → Settings → Domains, thêm `demo.artium.id.vn`, rồi tạo bản ghi DNS `demo` ở iNET bằng giá trị Vercel hướng dẫn. Giữ proxy tắt trong bài học này.

Trước khi thử FE ở URL `.vercel.app`, thêm **origin chính xác** của URL đó vào `ALLOWED_ORIGINS` trong `backend/.env` trên EC2, giữ các giá trị hiện có và ngăn cách bằng dấu phẩy. Origin không có đường dẫn và không có dấu `/` cuối. Sau khi sửa:

```bash
sudo systemctl restart cloud-demo
```

`https://demo.artium.id.vn` đã nằm trong `.env.example`. Mỗi Vercel preview URL khác cũng cần được thêm chính xác nếu muốn gọi API; không cho phép toàn bộ `*.vercel.app`.

## Cập nhật sau này

Push commit lên repo để Vercel cập nhật FE. Trên EC2, từ folder repo:

```bash
git pull --ff-only
npm test
sudo systemctl restart cloud-demo
curl https://aws.artium.id.vn/api/health
```

`.env` và key `.pem` đã nằm trong `.gitignore`. Cấu hình frontend là public: chỉ đặt địa chỉ API, không đặt password hoặc API key trong `frontend/config.js`.

## Bài demo hoàn tất khi

- `https://aws.artium.id.vn/api/health` trả JSON status `ok`.
- `https://demo.artium.id.vn` báo API đã kết nối.
- Gửi tên nhận đúng lời chào; JSON được hiển thị trong phần mở rộng.
- Tắt backend để thử trạng thái lỗi, bật lại rồi bấm Kiểm tra kết nối.

Backend chưa có database/auth vì bài này tập trung HTTP, CORS, EC2, DNS và HTTPS. Chỉ thêm lưu trữ hoặc đăng nhập khi bài tiếp theo cần đến chúng.
