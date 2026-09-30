// FE trên Vercel gọi BE trên EC2. Local dùng backend đang phục vụ trang này.
window.DEMO_API_URL = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ? window.location.origin
  : 'https://aws.artium.id.vn';
