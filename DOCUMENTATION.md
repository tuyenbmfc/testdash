# NTSF Seafoods — Executive Sales Performance Dashboard
## Tài Liệu Kỹ Thuật Tổng Hợp (bản cập nhật)

> Tài liệu này mô tả toàn bộ hệ thống ở trạng thái hiện tại: dashboard, 6 luồng Power Automate,
> hệ thống tự động đọc invoice, và cấu trúc dữ liệu Excel. Dùng để tra cứu khi cần bảo trì,
> mở rộng, hoặc bàn giao cho người khác.

---

## 1. Tổng Quan Kiến Trúc

```
┌─────────────────────────────────────────────────────────────────────┐
│  NGUỒN DỮ LIỆU                                                        │
│                                                                        │
│  Sale Admin nhập tay          Invoice (.xlsx) tự động đọc            │
│  vào ActualSales/TargetPlan   qua thư mục OneDrive "Invoices"        │
│         │                              │                              │
│         │                    Office Script (ExtractInvoiceData.ts)   │
│         │                              │                              │
│         └──────────────┬───────────────┘                              │
│                         ▼                                              │
│         NTSF_SharePoint_Source.xlsx (OneDrive/SharePoint)             │
│         Sheets: ActualSales, TargetPlan, MonthlySummary,              │
│                 SaleSummary, InvoiceCustomerMap, CountryMarketMap     │
└─────────────────────────┬───────────────────────────────────────────┘
                           ▼
              6 Power Automate Flows (A–F, xem mục 3)
                           ▼
              JSON API endpoints (HTTP-triggered)
                           ▼
         Dashboard tĩnh (index.html + config.js + data-service.js)
              lưu trên GitHub Pages, tự làm mới mỗi 5 phút
```

**Không có backend server riêng.** Toàn bộ "logic nghiệp vụ" nằm ở 3 nơi:
1. Power Automate flows (đọc/ghi Excel, tra cứu)
2. Office Script `ExtractInvoiceData.ts` (đọc invoice, chuẩn hoá dữ liệu)
3. JavaScript trong dashboard (`app.js`, `data-service.js`) — tính toán, hiển thị, phân loại

---

## 2. Cấu Trúc File Excel — `NTSF_SharePoint_Source.xlsx`

| Sheet | Vai trò | Ai đọc/ghi |
|---|---|---|
| **ActualSales** | Dữ liệu xuất hàng thực tế, mỗi dòng = 1 mặt hàng của 1 lô hàng (1 invoice có thể ra nhiều dòng) | Flow A đọc; Sale Admin nhập tay HOẶC Flow F ghi tự động |
| **TargetPlan** | Lịch sử chỉ tiêu/điều chỉnh chỉ tiêu theo Sale, theo năm, có versioning | Flow B đọc; Flow C ghi (qua nút "✏️ Sửa" trên dashboard); Sale Admin nhập tay cho năm mới |
| **MonthlySummary** | Dữ liệu tổng hợp theo Tháng × Thị trường cho **năm chưa có chi tiết** (ví dụ 2025) | Flow D đọc; Sale Admin nhập tay |
| **SaleSummary** | Doanh số thực xuất theo Sale cho năm chưa có chi tiết | Flow E đọc; Sale Admin nhập tay |
| **InvoiceCustomerMap** | Tra cứu **Customer + Sale** từ tên người mua trên invoice | Flow F đọc; Sale Admin duy trì |
| **CountryMarketMap** | Tra cứu **Market** từ tên Quốc gia đọc được trên invoice | Flow F đọc; Sale Admin duy trì |

### 2.1 Cấu trúc cột `ActualSales`

| Cột | Nguồn | Ghi chú |
|---|---|---|
| ShipmentId | Số invoice thật, hoặc tự sinh | Chỉ hiện ở dòng đầu tiên nếu 1 invoice có nhiều mặt hàng — các dòng sau để trống, hiểu ngầm là cùng invoice |
| Year, Quarter, Month | Tính từ ShipmentDate | |
| ShipmentDate | Đọc từ invoice ("DATE OF SHIPMENT") | Định dạng YYYY-MM-DD |
| Sale | Tra `InvoiceCustomerMap`, dự phòng "Chưa gán" | |
| Customer | Tra `InvoiceCustomerMap`, dự phòng giữ nguyên tên trên invoice | |
| CustomerCode | Dashboard **tự sinh** nếu để trống (băm từ tên Customer, ổn định qua các lần refresh) | Không cần điền tay |
| Country | Đọc **trực tiếp** từ invoice ("PLACE OF DESTINATION"/"PLACE OF DELIVERY"/"PLACE OF FINAL DESTINATION") | KHÔNG qua bảng tra nào |
| Market | Tra `CountryMarketMap` theo đúng Country vừa đọc, dự phòng dùng nguyên Country nếu chưa có trong bảng | Độc lập hoàn toàn với Customer |
| Product | Tên mặt hàng (có thể viết tràn nhiều dòng trên invoice, script tự nối) | |
| ProductGroup | Dashboard tự phân loại theo **loài cá** (Pangasius/Tilapia/Khác) từ tên Product | Không cần điền tay |
| ProductClassification | Dashboard tự phân loại **Thô/GTGT** theo từ khoá trong tên Product | Không cần điền tay |
| ASClabel | "yes"/"no" — tự phát hiện chữ "ASC" (đứng riêng) trong mô tả hàng hoá | |
| ContractNo | Đọc từ invoice, tự cắt bỏ phần "DATED:..." nếu bị dính chung | |
| ContainerNo | Đọc từ invoice ("CONTAINER / SEAL NO."), chỉ lấy phần trước dấu "/" (bỏ Seal No) | |
| BillNo | Đọc từ invoice ("BILL OF LADING NO"), dự phòng tra tiếp sheet Bill nếu không có trên Invoice sheet | |
| ShipmentQty | Khối lượng (kg) — **đã tự quy đổi từ LBS sang KG** nếu invoice ghi bằng pound | |
| ShipmentRevenue | Doanh thu (USD) | |

**Quy ước quan trọng:** mỗi dòng ActualSales = 1 container (dùng để tính KPI "Tổng Số Container Đã Xuất" bằng cách đếm số dòng).

### 2.2 `InvoiceCustomerMap` (đã đơn giản hoá — chỉ còn 3 cột)

| Cột | Ý nghĩa |
|---|---|
| BuyerNameContains | Từ khoá ngắn, xuất hiện trong tên người mua trên invoice (ví dụ "FASTNET") |
| Customer | Tên khách hàng chuẩn hoá, dùng trong ActualSales |
| Sale | Sale phụ trách khách hàng đó |

*(Trước đây có thêm cột Market/Region — đã bỏ, chuyển Market sang tra theo Quốc gia ở CountryMarketMap để chính xác hơn.)*

### 2.3 `CountryMarketMap` (2 cột)

| Cột | Ý nghĩa |
|---|---|
| Country | Tên quốc gia, phải khớp đúng chính tả với cách invoice ghi (tiếng Anh) |
| Market | Nhóm thị trường tương ứng |

**Quy tắc thị trường hiện tại** (có thể sửa bất cứ lúc nào trong bảng, không cần sửa code):
- Anh (United Kingdom) tách riêng, không gộp vào EU
- Ai Cập (Egypt) = "Châu Phi", UAE (United Arab Emirates) = "Trung Đông" — **tách riêng nhau**
- Các nước châu Âu còn lại gộp chung "EU"
- 9 thị trường gốc: USA, EU, China, Canada, Chile, Panama, Korea, Nội địa — cộng thêm Anh, Trung Đông, Châu Phi

---

## 3. Power Automate — 6 Flow

| Flow | Tên | Trigger | Việc làm |
|---|---|---|---|
| A | GetActualSales | HTTP (GET) | Đọc toàn bộ ActualSales, trả JSON |
| B | GetSalesTargets | HTTP (GET) | Đọc toàn bộ TargetPlan, trả JSON |
| C | SubmitTargetRevision | HTTP (POST) | Ghi 1 dòng điều chỉnh chỉ tiêu mới vào TargetPlan |
| D | GetMonthlySummary | HTTP (GET) | Đọc MonthlySummary, trả JSON |
| E | GetSaleSummary | HTTP (GET) | Đọc SaleSummary, trả JSON |
| F | **ProcessNewInvoice** | OneDrive — khi có file mới trong `Invoices/` | Đọc invoice, tra cứu, ghi (nhiều) dòng vào ActualSales |

### 3.1 Chi tiết Flow F — `ProcessNewInvoice`

```
1. Trigger: When a file is created (properties only) — Folder = "Invoices"
2. Run script — chạy ExtractInvoiceData.ts trên ĐÚNG file vừa upload
   (File = chọn "Identifier"/"File Id" động từ bước 1, KHÔNG cố định 1 file)
   → Trả về 1 DANH SÁCH (mảng) — mỗi phần tử là 1 mặt hàng của invoice đó
3. List rows present in a table — đọc InvoiceCustomerMap
4. Filter array (tên nội bộ: Filter_array)
   From: outputs('List_rows_present_in_a_table')?['body/value']
   Where: @contains(toUpper(outputs('Run_script')?['body/result'][0]?['buyerNameRaw']),
                     toUpper(item()?['BuyerNameContains']))
5. Apply to each — lặp qua outputs('Run_script')?['body/result']
   ├─ 5a. List rows present in a table (tên: List_rows_CountryMarketMap)
   │      — đọc CountryMarketMap
   ├─ 5b. Filter array (tên: Filter_array_Market)
   │      From: outputs('List_rows_CountryMarketMap')?['body/value']
   │      Where: @equals(toUpper(item()?['Country']),
   │                      toUpper(items('Apply_to_each')?['country']))
   └─ 5c. Add a row into a table — ghi vào ActualSales, dùng item()?['...']
          cho các trường theo từng mặt hàng, dùng body('Filter_array')/
          body('Filter_array_Market') cho Sale/Customer/Market
6. (Khuyến nghị, tuỳ chọn) Move file — chuyển invoice đã xử lý sang Invoices/Processed
```

**Công thức đầy đủ cho bước "Add a row into a table" (bên trong Apply to each):**

| Cột | Công thức |
|---|---|
| ShipmentId | `item()?['shipmentId']` |
| Year / Quarter / Month | `item()?['year']` / `item()?['quarter']` / `item()?['month']` |
| ShipmentDate | `item()?['shipmentDate']` |
| Sale | `if(empty(body('Filter_array')?[0]?['Sale']), 'Chưa gán', body('Filter_array')?[0]?['Sale'])` |
| Customer | `if(empty(body('Filter_array')?[0]?['Customer']), item()?['buyerNameRaw'], body('Filter_array')?[0]?['Customer'])` |
| Country | `item()?['country']` |
| Market | `if(empty(body('Filter_array_Market')?[0]?['Market']), item()?['country'], body('Filter_array_Market')?[0]?['Market'])` |
| Product | `item()?['product']` |
| ProductGroup | `item()?['productGroup']` |
| ProductClassification | `item()?['productClassification']` |
| ASClabel | `item()?['ascLabel']` |
| ContractNo | `item()?['contractNo']` |
| ContainerNo | `item()?['containerNo']` |
| BillNo | `item()?['billNo']` |
| ShipmentQty | `item()?['shipmentQty']` |
| ShipmentRevenue | `item()?['shipmentRevenue']` |

**⚠️ 3 lỗi Power Automate hay gặp nhất khi chỉnh sửa flow này** (đã tốn nhiều công debug thật):

1. **Output của "Run script" nằm trong `body/result`, không phải `body`** — luôn phải viết `outputs('Run_script')?['body/result/xxx']`, thiếu chữ `result` sẽ ra `Null`.
2. **`item()` bên trong 1 "Filter array" luôn trỏ về dòng đang lọc CỦA CHÍNH Filter array đó**, không phải dòng đang lặp của "Apply to each" bên ngoài — muốn lấy dữ liệu từ vòng lặp ngoài, phải dùng `items('Tên_Apply_to_each')?['...']` (số nhiều, có tham số tên vòng lặp).
3. **`contains(A, B)` kiểm tra "A có chứa B"** — dễ viết ngược thứ tự 2 tham số, dẫn đến so sánh luôn sai. Chuỗi NGẮN (từ khoá) phải là tham số B, chuỗi DÀI (tên đầy đủ) là tham số A.
4. Office Scripts (chạy qua Power Automate) **không hỗ trợ `.filter()` trên kết quả `workbook.getWorksheets()`** — phải dùng vòng lặp `for` thường.
5. `.map()` với tên hàm truyền trực tiếp (`array.map(tenHam)`) bị lỗi "Only arrow functions may be used" — phải viết `array.map((x) => tenHam(x))`.
6. Action "Run script" **chỉ chạy được trên file `.xlsx`**, không chạy được `.xls` — invoice cũ cần Save As sang `.xlsx` trước khi upload.

---

## 4. Office Script — `ExtractInvoiceData.ts`

### 4.1 Nguyên lý cốt lõi: đọc theo NHÃN, không theo địa chỉ ô cố định

Vì các invoice thật (dù cùng 1 mẫu công ty) có thể lệch dòng/cột do độ dài tên khách hàng khác nhau,
số mặt hàng khác nhau, hoặc có/không có 1 số cột phụ — script **không bao giờ đọc theo địa chỉ ô cố
định** (ví dụ "C8"), mà luôn **tìm ô có chữ khớp với nhãn** (ví dụ "CONTRACT NO.") rồi đọc giá trị
liền kề.

### 4.2 Các trường được trích xuất

| Trường | Cách lấy |
|---|---|
| shipmentId | Số invoice (dòng "NO.: xxx"), bỏ dấu "/" |
| contractNo | Nhãn "CONTRACT NO", tự cắt phần "DATED:..." nếu dính chung |
| shipmentDate | Nhãn "DATE OF SHIPMENT" |
| country | Nhãn "PLACE OF DESTINATION"/"PLACE OF DELIVERY"/"PLACE OF FINAL DESTINATION" (thử lần lượt) |
| buyerNameRaw | Nhãn "FOR ACCOUNT AND RISK OF MESSRS", quét xuống + quét ngang tìm dòng đầu tiên có nội dung, bỏ qua các nhãn phụ như "TO CONSIGNEE", "DATED" |
| containerNo | Nhãn "CONTAINER..." (nhiều biến thể), chỉ lấy phần trước dấu "/" |
| billNo | Nhãn "BILL OF LADING NO", dự phòng tra thêm sheet Bill |
| product (nhiều dòng) | Xem mục 4.3 |
| productGroup | Suy luận từ tên sản phẩm: có "PANGASIUS"/"SWAI"/"BASA" → Pangasius; có "TILAPIA" → Tilapia; còn lại → Khác |
| productClassification | Có PORTION/NUGGET/LOIN/SKEWER/MARINATED/STRIP → GTGT; có FILLET (không kèm từ khoá GTGT) → Thô; còn lại → Chưa phân loại |
| ascLabel | Quét toàn bộ khu vực mô tả hàng hoá tìm chữ "ASC" đứng riêng (word-boundary, không nhầm "CASCADE") |
| shipmentQty, shipmentRevenue | Tổng theo TỪNG mặt hàng (không phải tổng chung cả invoice) |
| unitPriceUsdPerKg | Doanh thu ÷ khối lượng; ưu tiên dùng cột "Weight Including Glazing" nếu invoice có, không thì dùng Net Weight |

**Quy đổi đơn vị:** nếu cột khối lượng ghi "(LBS)" thay vì "(KGS)", script tự nhân với `0.45359237`
để quy đổi sang kg trước khi ghi vào ActualSales.

**Bên trung gian:** nếu Contract No chứa chữ "NTSF-NTSFCOM", tên trên invoice chỉ là bên nhận hàng hộ
(forwarder) — script tự tìm sang sheet "Bill", mục "NOTIFY", lấy **bên số 2)** (Notify Party 2) làm
khách hàng thật, bỏ qua bên số 1) (luôn là công ty logistics).

### 4.3 Xử lý invoice có nhiều mặt hàng — mỗi mặt hàng = 1 dòng riêng

Script quét từng dòng trong khu vực mô tả hàng hoá:
- Dòng có số ở cột "cartons" → là dòng dữ liệu (1 size/lô), cộng dồn khối lượng/doanh thu vào
  đúng mặt hàng đang xét
- Dòng có chữ, không phải nhãn phụ (SIZE/PACKING/SCIENTIFIC NAME/ASC NUMBER/tên thương hiệu
  trong ngoặc kép/tên khoa học trong ngoặc đơn...) → là tên sản phẩm
- Nếu dòng có đánh số "1./", "2./" ở đầu → bắt đầu 1 mặt hàng MỚI
- Nếu không đánh số → **nối thêm** vào tên mặt hàng đang có (xử lý trường hợp tên sản phẩm viết
  tràn nhiều dòng)
- Chỉ bắt đầu theo dõi SAU khi đã qua dòng "DESCRIPTION OF GOODS" (tránh nhầm phần đầu invoice)

Kết quả: mỗi mặt hàng ra 1 phần tử trong danh sách trả về, có khối lượng/doanh thu/giá riêng — luôn
được đối chiếu khớp với dòng TOTAL gốc trên invoice (đã kiểm chứng khớp 100% qua toàn bộ invoice
test thật).

### 4.4 Xử lý cột lệch vị trí

Vì một số invoice có thêm cột "khối lượng gồm lớp mạ băng" (glazing) mà invoice khác không có,
script **không dùng số thứ tự cột cố định** cho Cartons/Net Weight/Amount — mà tìm theo tiêu đề
cột: "(CTNS)" hoặc "(PALLETS)", "(USD)", và dò "NET"/"GLAZING" ở các dòng phía trên.

### 4.5 Lịch sử test — 8 invoice thật, 16 lỗi thực tế phát hiện và vá

Trong quá trình phát triển, đã test với 8 invoice thật (nhiều thị trường: Trung Quốc, Hà Lan, Mỹ,
Anh, UAE khác nhau về bố cục) và phát hiện/vá các lỗi: lệch dòng do độ dài địa chỉ, lệch cột do cột
phụ, đơn vị LBS thay vì KGS, tên khoa học không có nhãn, dòng "ASC NUMBER"/tên thương hiệu bị nhận
nhầm thành sản phẩm, nhãn viết khác nhau giữa các invoice, sheet đặt tên khác nhau ("INVOICE",
"INVOICE (hq)", "INVOICE(LUU)"), tên khách hàng lệch cột so với nhãn, mô tả sản phẩm viết tràn
nhiều dòng, hợp đồng qua trung gian cần tra Notify Party 2, số hợp đồng dính thêm "DATED:...".

---

## 5. Dashboard — Tính Năng Chính

### 5.1 Chọn năm & 2 chế độ hiển thị

- **Năm có dữ liệu chi tiết** (ví dụ 2026, 2027): hiển thị đầy đủ — KPI, bộ lọc, Sales Ranking,
  Khách hàng, Sản phẩm, Heatmap, bản đồ, bảng chi tiết...
- **Năm chỉ có dữ liệu tổng hợp** (ví dụ 2025 — tự động phát hiện, gắn nhãn "TỔNG HỢP" trên nút
  chọn năm): chuyển sang màn hình riêng gọn — chỉ hiện Tổng Quan (KPI, xu hướng theo tháng, cơ
  cấu thị trường, Target vs Actual theo Sale), ẩn hết phần đòi hỏi dữ liệu chi tiết.

### 5.2 Nhóm KPI Điều Hành

12 chỉ số chính + **Tổng Số Container Đã Xuất** + **Giá Bán Trung Bình (ASP)**.

### 5.3 Tăng Trưởng Xuất Khẩu Theo Tháng

- Tự động chọn **tháng gần nhất ĐÃ HOÀN TẤT** để so sánh (không so sánh tháng đang xuất dở, dựa
  theo ngày thật của hệ thống — không dùng ngày cố định)
- So sánh MoM + YoY (dùng dữ liệu tổng hợp làm dự phòng nếu năm trước chưa có chi tiết — vẫn hoạt
  động được khi đang lọc theo Thị trường)
- 4 biểu đồ: Khối lượng, Doanh số, Giá bán trung bình, Số lượng Container — tooltip rê chuột hiện
  đúng % tăng/giảm của CHÍNH chỉ số đang xem (không lẫn chỉ số khác)

### 5.4 Phân Tích Tăng Trưởng: Thực Xuất Năm Trước vs Chỉ Tiêu Năm Nay

So sánh Actual năm trước (từ SaleSummary) với Target năm nay, tính % tăng trưởng yêu cầu, dự báo
cuối năm theo tốc độ hiện tại, gắn nhãn "✅ Có khả năng đạt / ⚠️ Cần cố gắng / ❌ Khó đạt".

### 5.5 Vòng Đời Khách Hàng

Khách hàng mới trong năm / cũ chưa mua lại / mua cả 2 năm.

### 5.6 Phân Tích Theo Sản Phẩm

Tự động tách theo Product/ProductGroup — sẵn sàng mở rộng khi có nhiều mặt hàng hơn (không cần
sửa code, chỉ cần dữ liệu Product đa dạng hơn).

### 5.7 Bản Đồ Doanh Thu Theo Vị Trí Địa Lý

Dùng Leaflet.js + OpenStreetMap (miễn phí). Vòng tròn kích thước theo doanh thu, bấm vào xem top
khách hàng từng thị trường.

### 5.8 Bảng Chi Tiết

Cột: Sale, Khách Hàng, Quốc Gia, Ngày Xuất Hàng, Số Hợp Đồng, Sản Phẩm, Lượng, **Giá Trị**, Số
Container, Số Bill (tự ẩn trên màn hình hẹp nhưng vẫn tìm kiếm được). Mặc định sắp xếp **mới nhất
lên đầu**. Ô tìm kiếm bao gồm cả Số Container/Số Bill — hữu ích khi khách hàng chỉ cung cấp số
container mà không nhớ số hợp đồng.

### 5.9 Xuất Báo Cáo PDF Theo Sale

Chọn đúng 1 Sale → xuất PDF gọn, có logo + tiêu đề + mốc thời gian, ẩn bản đồ nhiệt (không phù hợp
in ấn).

### 5.10 Đăng Nhập & Bảo Mật

- Mật khẩu client-side (SHA-256) — lớp bảo vệ cơ bản, **không phải xác thực máy chủ thật**
- Khuyến nghị bổ sung: HTTP Basic Auth (`.htaccess`) nếu chuyển sang hosting riêng, để chặn từ
  tầng máy chủ (xem mục 7)

---

## 6. Cách Bảo Trì Thường Gặp

| Việc cần làm | Cách làm |
|---|---|
| Thêm khách hàng mới | Thêm 1 dòng vào `InvoiceCustomerMap` (BuyerNameContains, Customer, Sale) |
| Thêm/sửa quy tắc thị trường | Sửa trực tiếp `CountryMarketMap` — không cần sửa code |
| Thêm chỉ tiêu năm mới | Thêm dòng vào `TargetPlan` với đúng Year, Version=0, VersionLabel="Original Plan" |
| Phân loại lại sản phẩm cũ theo khách hàng | Dùng Filter trên cột Customer trong ActualSales, copy-paste hàng loạt vào cột Product |
| Xử lý invoice mẫu mới/khác | Gửi Claude 1 file invoice mẫu để kiểm tra + cập nhật `ExtractInvoiceData.ts` |
| Đổi mật khẩu dashboard | Tạo hash SHA-256 mới (console trình duyệt), thay vào `config.js` |

---

## 7. Cân Nhắc Bảo Mật (đã trao đổi, để tham khảo)

- Dashboard hiện host trên **GitHub Pages** (repo công khai) — bất kỳ ai có link đều xem được mã
  nguồn qua "View Page Source", kể cả khi chưa nhập đúng mật khẩu (vì mật khẩu là JS phía trình
  duyệt, không phải xác thực máy chủ)
- Muốn bảo mật hơn thật sự, cần **HTTP Basic Auth** (`.htaccess`) — chặn ngay từ tầng máy chủ, chỉ
  hosting cPanel trả phí mới có, GitHub Pages không có tính năng này ở bất kỳ gói nào
- Domain rút gọn/ẩn danh + `robots.txt` chặn Google index → giảm khả năng bị phát hiện tình cờ,
  nhưng không thay thế cho xác thực thật

---

## 8. Giới Hạn Đã Biết

1. Script invoice giả định đúng 1 mẫu Commercial Invoice cố định (dù khá linh hoạt với biến thể) —
   đổi hẳn sang mẫu invoice khác cần kiểm tra/chỉnh lại
2. Action "Run script" chỉ hỗ trợ `.xlsx`, cần chuyển đổi thủ công nếu invoice gốc là `.xls`
3. Chưa có tính năng AI phân tích tự động theo yêu cầu tự do của BGĐ (đã thảo luận thiết kế, cần
   quyết định về ngân sách Anthropic API trước khi triển khai)
4. Region đã được loại bỏ khỏi toàn hệ thống — nếu sau này cần lại, phải thiết kế lại từ đầu
