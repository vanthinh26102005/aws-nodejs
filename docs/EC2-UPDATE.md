# Cập nhật web demo trên EC2

Thực hiện sau khi commit mới đã merge vào `main`. Frontend Vercel cập nhật từ GitHub nếu project vẫn theo dõi `main`; backend trên EC2 cần pull và restart thủ công. Không cần đổi DNS, mở port 3000 hoặc cài lại Caddy.

## 1. Pull và kiểm tra code

Từ Mac:

```bash
ssh -i ~/Downloads/nodejs-learning-key.pem ubuntu@aws.artium.id.vn
```

Trong Ubuntu:

```bash
cd ~/cloud-services-demo
git status --short --branch
git remote -v
```

Repo phải có origin `https://github.com/vanthinh26102005/aws-nodejs.git` (hoặc SSH của cùng repo). Nếu có thay đổi tracked, lưu/commit chúng trước; không dùng reset/clean để cập nhật. File `backend/.env` ignored được giữ nguyên.

```bash
git switch main
git pull --ff-only origin main
npm ci
npm test
```

Chỉ tiếp tục khi các lệnh thành công. Không chạy thêm `npm start` nếu systemd `cloud-demo` đang dùng port 3000.

## 2. IAM cho SNS và Lex

IAM → Roles → **ArtiumCloudDemoEC2** → Add permissions → Create inline policy → JSON. Thêm policy mới tên **ArtiumWebSNSLex**; giữ policy S3 đang có. Policy Lex riêng đã cấp trước đó cũng có thể giữ nguyên.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:ap-southeast-1:461508717285:artium-cloud-demo-alerts"
    },
    {
      "Effect": "Allow",
      "Action": "lex:RecognizeText",
      "Resource": "arn:aws:lex:ap-southeast-1:461508717285:bot-alias/JHDVF8HBVM/TSTALIASID"
    }
  ]
}
```

SNS → topic **artium-cloud-demo-alerts** → Subscriptions: email cần trạng thái **Confirmed**, không phải Pending confirmation. Lex English (US) cần build thành công; TestBotAlias dùng bản Draft, phù hợp bài lab.

EC2 dùng role, không thêm access key vào `.env` hoặc chạy `aws configure` để thay role.

## 3. Kiểm tra EFS trước khi tạo thư mục

```bash
findmnt --mountpoint /mnt/efs-demo -o SOURCE,TARGET,FSTYPE
```

Phải thấy `nfs4` (SOURCE `127.0.0.1:/` là bình thường khi dùng TLS). Nếu chưa mount, chạy:

```bash
sudo mount /mnt/efs-demo
```

Lệnh này dùng dòng `/etc/fstab` đã thêm trong bài EFS:

```text
fs-071105af93a89496d:/ /mnt/efs-demo efs _netdev,noresvport,tls,nofail 0 0
```

Nếu chưa có dòng fstab, mount trực tiếp bằng helper đã cài:

```bash
sudo mkdir -p /mnt/efs-demo
sudo mount -t efs -o tls fs-071105af93a89496d:/ /mnt/efs-demo
```

Chỉ tạo thư mục khi mount đã thành công:

```bash
mountpoint -q /mnt/efs-demo && sudo install -d -o ubuntu -g ubuntu /mnt/efs-demo/thinh
```

Backend chạy user `ubuntu`, ghi file `web-demo.txt` trong thư mục này. File bài lab `hello.txt` và `node-demo.txt` không bị thay đổi. Không cần thêm quyền AWS SDK cho EFS khi dùng mount TLS không có tùy chọn `iam`; vẫn cần mount target/SG NFS 2049 và quyền filesystem như bài trước. Backend kiểm tra NFS ở mỗi request, nên sau reboot mất mount thì riêng EFS trả 503, các dịch vụ khác vẫn có thể chạy.

## 4. Thêm biến môi trường, giữ cấu hình cũ

Tạo mã ngẫu nhiên riêng bằng lệnh dưới, tự giữ mã để nhập trên web; không gửi mã vào chat hoặc commit lên GitHub:

```bash
openssl rand -hex 32
nano backend/.env
```

Giữ `HOST`, `PORT`, `ALLOWED_ORIGINS`, `S3_BUCKET` đang có. Thêm hoặc sửa các biến dưới; mỗi biến chỉ có một dòng. Dòng `DEMO_WRITE_TOKEN` phải được điền bằng mã 64 ký tự vừa tạo.

```dotenv
AWS_REGION=ap-southeast-1
DEMO_WRITE_TOKEN=
SNS_TOPIC_ARN=arn:aws:sns:ap-southeast-1:461508717285:artium-cloud-demo-alerts
EFS_DIRECTORY=/mnt/efs-demo/thinh
LEX_BOT_ID=JHDVF8HBVM
LEX_BOT_ALIAS_ID=TSTALIASID
LEX_LOCALE_ID=en_US
SES_REGION=ap-southeast-1
SES_FROM_EMAIL=
SES_TO_EMAIL=vanthinh.dev@gmail.com
```

SES_FROM_EMAIL giữ trống vì SES chưa thực hành. Web sẽ báo chưa cấu hình SES, nhưng SNS/EFS/Lex vẫn chạy. Không copy `.env.example` đè lên `.env` đang dùng. Nếu `.env` chưa tồn tại mới dùng `cp backend/.env.example backend/.env` trước khi sửa.

Nano: Ctrl+O → Enter → Ctrl+X. Sau đó:

```bash
chmod 600 backend/.env
sudo systemctl restart cloud-demo
sudo systemctl status cloud-demo --no-pager
curl --max-time 15 https://aws.artium.id.vn/api/health
```

Đợi vài giây sau restart nếu curl chưa kết nối. Health phải trả `status: "ok"`, `services.sns/efs/lex: true`, `services.ses: false`. Các cờ này chỉ kiểm tra biến cấu hình, chưa chứng minh gọi dịch vụ thật. Không cần copy lại unit systemd vì đường dẫn/lệnh start vẫn như trước. Nếu unit chưa cài, dùng các lệnh trong mục Chạy backend trên EC2 của README.

Nếu lỗi:

```bash
sudo journalctl -u cloud-demo -n 50 --no-pager
```

## 5. Thử trên web

Vercel project → Deployments: đợi deployment của `main` Ready. Mở **https://demo.artium.id.vn** và refresh. Vercel Root Directory vẫn là `frontend`, không có build command.

1. Nhập mã vừa tạo vào **Mã truy cập demo**. Mã chỉ giữ trong trang đang mở; reload cần nhập lại.
2. **SNS**: nhập nội dung, bấm Gửi SNS. Message ID cho biết AWS đã nhận publish; kiểm tra email subscription để xác nhận giao nhận thực tế. Đợi ít nhất 10 giây giữa hai lần gửi.
3. **EFS**: ghi nội dung, bấm Đọc lại từ EFS. Kiểm tra trong Ubuntu:

   ```bash
   cat /mnt/efs-demo/thinh/web-demo.txt
   ```

4. **Lex V2**: gửi `I want to order a painting`, `sunset`, `2`, `yes`. Xem state, slot cần hỏi và JSON. Dùng Hội thoại mới rồi thử trả lời `no`. Nếu đã giới hạn PaintingCatalog, thử `order` làm tên tranh để kiểm tra bot hỏi lại. Lex không tự lưu đơn, gửi SNS hoặc SES.
5. Kiểm tra S3 và lời chào vẫn hoạt động.

Không gửi nội dung riêng tư trong bài demo. Các test tự động đã kiểm tra HTTP và logic với AWS fixtures; các bước trên mới xác nhận IAM, mount và dịch vụ AWS thật.

## 6. Bật SES sau bài verify email

Trong SES **Singapore**, verify identity email `vanthinh.dev@gmail.com` bằng link nhận trong inbox. Bài đơn giản có thể dùng cùng email làm sender và recipient. Trong sandbox, địa chỉ người nhận cũng phải được verify. Không cần yêu cầu production access cho bài gửi tới chính email đã verify.

Thêm inline policy **ArtiumWebSES** vào role EC2, khi dùng đúng email trên làm sender:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:ap-southeast-1:461508717285:identity/vanthinh.dev@gmail.com",
      "Condition": {
        "StringEquals": { "ses:FromAddress": "vanthinh.dev@gmail.com" },
        "ForAllValues:StringEquals": { "ses:Recipients": ["vanthinh.dev@gmail.com"] }
      }
    }
  ]
}
```

Sửa `SES_FROM_EMAIL=vanthinh.dev@gmail.com` trong `.env`, giữ SES_TO_EMAIL như trên, restart `cloud-demo`. Sau đó thử nút SES và kiểm tra inbox/spam. API 200 là AWS chấp nhận yêu cầu gửi, không đảm bảo email đã vào inbox.

Tài liệu: [SNS Publish SDK v3](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/sns-examples-publishing-messages.html), [SES sending requirements](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/ses-examples-sending-email.html), [EFS fstab](https://docs.aws.amazon.com/efs/latest/ug/mount-fs-auto-mount-update-fstab.html), [Lex RecognizeText](https://docs.aws.amazon.com/lexv2/latest/APIReference/API_runtime_RecognizeText.html).
