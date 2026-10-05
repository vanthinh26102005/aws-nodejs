# Artium Cloud Lab

Backend Node.js trên EC2, frontend HTML/CSS/JS trên Vercel. Demo kiểm tra API, gửi lời chào, mở file S3, phát thông báo SNS, gửi email SES, ghi/đọc file EFS và chat đặt tranh qua Lex V2. Chưa có database hoặc tạo đơn hàng thật. Frontend vẫn là HTML/CSS/JS thuần.

**Đã có EC2 đang chạy?** Xem [hướng dẫn pull code, cấu hình dịch vụ và restart](docs/EC2-UPDATE.md). SES đã có code nhưng cần verify email rồi mới bật cấu hình sender.

```text
cloud-services-demo/
├── package.json
├── package-lock.json
├── backend/
│   ├── server.mjs
│   ├── cloud.mjs
│   ├── check.mjs
│   ├── check-s3.mjs
│   ├── check-cloud.mjs
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
npm ci
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

`dev` tự khởi động lại backend khi code thay đổi; refresh trình duyệt để nhận FE mới. `test` dùng HTTP thật trên port tạm, kiểm tra API, validation, body limit, CORS và frontend assets. Test S3 kiểm tra prefix và ký URL bằng SDK. Test các dịch vụ mới dùng filesystem tạm thật, thay lời gọi AWS và phép kiểm tra mount bằng fixture; kiểm tra auth, đích gửi cố định, gửi lặp, EFS chưa mount/symlink và session Lex. Test không cần AWS credentials, không gửi email thật và không chứng minh kết nối tài nguyên AWS thật.

Local chưa có `S3_BUCKET` vẫn chạy lời chào bình thường; nút S3 báo chưa cấu hình. Muốn thử với S3 thật trên Mac cần cấu hình AWS credentials hợp lệ qua AWS CLI/profile. Trên EC2 dùng IAM role như phần S3 bên dưới.

## API

| Endpoint | Request | Kết quả |
| --- | --- | --- |
| `GET /api/health` | Không có body | Trạng thái, phiên bản Node, uptime, timestamp |
| `POST /api/greet` | JSON `{"name":"Thịnh"}` | Lời chào và timestamp |
| `GET /api/files` | Không có body | Tối đa 10 file trong `demo/`, size, lastModified, truncated |
| `GET /api/files/download?key=demo/ten-file.png` | Key URL-encoded | Link S3 có chữ ký, expiresIn = 300 giây |
| `POST /api/sns` | `{"message":"Xin chào"}` | SNS nhận publish, trả messageId |
| `POST /api/ses` | `{"message":"Email demo"}` | SES nhận yêu cầu gửi, trả messageId |
| `POST /api/efs` | `{"content":"File demo"}` | Ghi thay nội dung web-demo.txt trên EFS |
| `GET /api/efs` | Không có body | Đọc web-demo.txt trên EFS |
| `POST /api/lex` | `{"text":"hello","sessionId":"demo-session"}` | Câu trả lời, intent/slots/state, slot cần hỏi và confidence |

Bốn nhóm endpoint mới cần header `X-Demo-Token`, bằng `DEMO_WRITE_TOKEN` ít nhất 32 ký tự trên EC2. Mã được nhập vào ô password trên web, không nằm trong frontend config hoặc localStorage. Các API mới giới hạn chung 60 request/phút/instance; SNS và SES cách nhau ít nhất 10 giây cho mỗi dịch vụ. SDK không tự retry các yêu cầu mới để giảm gửi trùng. Nếu timeout, kiểm tra inbox trước khi gửi lại; với Lex có thể bắt đầu hội thoại mới.

SNS topic, SES sender/recipient và Lex bot/alias do backend cấu hình; client không được chọn tài nguyên hoặc người nhận khác. EFS chỉ đọc/ghi một file demo, kiểm tra filesystem NFS trước khi thao tác và không đọc qua symlink. Đây là một demo một instance, mã dùng chung; chưa có tài khoản, quyền theo người dùng hoặc bảo đảm gửi đúng một lần.

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
npm ci
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
npm ci
npm test
sudo systemctl restart cloud-demo
curl https://aws.artium.id.vn/api/health
```

`.env` và key `.pem` đã nằm trong `.gitignore`. Cấu hình frontend là public: chỉ đặt địa chỉ API, không đặt password hoặc API key trong `frontend/config.js`.

## Tích hợp S3 vào web demo

Luồng: **trình duyệt → API HTTPS trên EC2 → S3** để lấy danh sách hoặc ký link. Khi mở link, **trình duyệt → S3** trực tiếp. Caddy tiếp tục chuyển HTTPS vào Node.js tại `127.0.0.1:3000`; không cần đổi DNS iNET hoặc cài lại Caddy.

1. Trong S3, mở bucket **`artium-cloud-demo-thinh-20261005`**, tạo folder **`demo`**, upload file mẫu vào đó, ví dụ `demo/hello.txt` hoặc `demo/anh-demo.png`. Giữ **Block Public Access bật**, không bật public ACL. Chỉ đặt file có thể chia sẻ ở đây: API demo không yêu cầu đăng nhập và có thể cấp link cho bất kỳ file nào trong `demo/`.
2. Trong EC2 → instance → Actions → Security → Modify IAM role, kiểm tra role **`ArtiumCloudDemoEC2`** đã gắn vào instance. Role cần `s3:ListBucket` và `s3:GetObject`. AWS SDK tự lấy credentials từ role; không dùng `aws configure` hoặc thêm access key vào `.env` trên EC2.
3. Policy đọc toàn bộ bucket đã dùng trong bài terminal cũng hoạt động. Có thể thu hẹp policy **`ArtiumDemoS3Read`** cho web demo như sau (bài terminal liệt kê toàn bộ bucket sẽ cần đổi sang `Prefix: "demo/"`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::artium-cloud-demo-thinh-20261005",
      "Condition": { "StringEquals": { "s3:prefix": "demo/" } }
    },
    {
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::artium-cloud-demo-thinh-20261005/demo/*"
    }
  ]
}
```

4. Sau khi merge nhánh vào `main`, cập nhật trên **Terminal SSH Ubuntu**, trong repo:

```bash
cd ~/cloud-services-demo
git switch main
git pull --ff-only origin main
npm ci
npm test
nano backend/.env
```

Giữ `HOST`, `PORT` và `ALLOWED_ORIGINS` hiện có; thêm hoặc cập nhật hai dòng, không tạo dòng trùng:

```dotenv
AWS_REGION=ap-southeast-1
S3_BUCKET=artium-cloud-demo-thinh-20261005
```

Trong nano: Ctrl+O → Enter để lưu, Ctrl+X để thoát. Sau đó:

```bash
sudo systemctl restart cloud-demo
sudo systemctl status cloud-demo --no-pager
curl --max-time 15 https://aws.artium.id.vn/api/health
curl --max-time 15 https://aws.artium.id.vn/api/files
```

Service có thể mất vài giây nạp NVM sau restart. Không chạy thêm `npm start` khi `cloud-demo` đang dùng cổng 3000. Nếu cần xem lỗi:

```bash
sudo journalctl -u cloud-demo -n 50 --no-pager
```

5. Vercel tự deploy FE từ `main` sau merge, với Root Directory **`frontend`** như cũ. Đợi deployment **Ready**, mở **https://demo.artium.id.vn**, bấm **Xem file S3 → Mở file**. Tab mới mở file S3; nếu trình duyệt chặn popup, bấm **Link tải (5 phút)** trong danh sách. Hết hạn thì bấm **Mở file** để tạo link mới.

API list chỉ đọc trang đầu tối đa 10 object, bỏ folder marker; vì vậy có thể thấy ít hơn 10 file. `truncated: true` nghĩa là còn object chưa hiển thị. Không có phân trang trong bài demo này. Link có hiệu lực tối đa 5 phút, và có thể hết hạn sớm nếu credentials của role hết hạn hoặc quyền/file bị thay đổi. Không cần bật S3 CORS để mở file qua link trong tab mới; frontend không fetch nội dung file S3.

Lỗi thường gặp: **503** nếu thiếu `S3_BUCKET`; **502** nếu sai region/bucket, thiếu IAM permission hoặc AWS không phản hồi; **400** nếu key nằm ngoài `demo/` hoặc không hợp lệ. S3 có thể trả **403** cho file không tồn tại khi policy giới hạn quyền liệt kê; backend sẽ trả 502 trong trường hợp đó. File trả 404 từ S3 được chuyển thành 404 trên API download.

### Ảnh minh chứng cho phần S3

- `[CHÈN ẢNH S3-1 — Bucket và file nằm trong folder demo/, Block Public Access bật]`
- `[CHÈN ẢNH S3-2 — IAM role ArtiumCloudDemoEC2 gắn vào instance, quyền đọc bucket]`
- `[CHÈN ẢNH S3-3 — Terminal: npm test PASS và curl /api/files trả danh sách thật]`
- `[CHÈN ẢNH S3-4 — Web demo hiển thị danh sách file và JSON của GET /api/files]`
- `[CHÈN ẢNH S3-5 — Tab mở file từ S3 bằng presigned URL; che phần query chữ ký khi chia sẻ ảnh]`

Tài liệu: [AWS SDK credentials cho Node.js](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html), [ListObjectsV2](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html), [S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html).

## Bài demo hoàn tất khi

- `https://aws.artium.id.vn/api/health` trả JSON status `ok`.
- `https://demo.artium.id.vn` báo API đã kết nối.
- Gửi tên nhận đúng lời chào; JSON được hiển thị trong phần mở rộng.
- Xem được file trong `demo/` từ bucket S3 thật và mở file bằng link có chữ ký.
- Tắt backend để thử trạng thái lỗi, bật lại rồi bấm Kiểm tra kết nối.

Backend chưa có database/auth vì bài này tập trung HTTP, CORS, EC2, DNS, HTTPS và S3. Chỉ thêm đăng nhập hoặc lưu dữ liệu người dùng khi bài tiếp theo cần đến chúng.
