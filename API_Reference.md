# دليل API الكامل — نظام إدارة المناسبات (MVP Backend مكتمل)

**Base URL:** `http://localhost:3000`

**المصادقة:** هذا النظام **لا يستخدم API Key**. المصادقة تتم عبر **JWT Bearer Token** تحصل عليه من `/auth/login` أو `/auth/register/...`، وتُرسله في كل طلب محمي عبر Header:
```
Authorization: Bearer <accessToken>
```

كل خطأ في أي مسار يعود بنفس الشكل الموحّد:
```json
{ "statusCode": 404, "error": "Not Found", "message": "...", "path": "/events/999", "timestamp": "..." }
```

---

# 0. الصحة العامة — `/health`

## GET `/health`
- **الحماية:** بلا (عام)
- **Parameters:** لا يوجد
- **الوصف:** يتحقق من اتصال قاعدة البيانات فعليًا.
- **استجابة النجاح:** `{ "status": "ok", "database": "connected", "timestamp": "..." }`
- **عند الفشل:** `503 Service Unavailable`

---

# 1. المصادقة والتسجيل — `/auth`

## POST `/auth/register/customer`
- **الحماية:** بلا (عام)
- **Body (JSON):**
  | Parameter | النوع | إلزامي | الوصف |
  |---|---|---|---|
  | firstName | string | نعم | الاسم الأول (2 حرف+) |
  | lastName | string | نعم | الاسم الأخير (2 حرف+) |
  | email | string | نعم | بريد إلكتروني صالح وفريد |
  | password | string | نعم | 8 أحرف على الأقل |
- **الوصف:** يُنشئ حساب عميل، يُفعَّل تلقائيًا (`accountStatus: APPROVED`).

## POST `/auth/register/professional`
- **الحماية:** بلا (عام)
- **Body: form-data** (وليس JSON، لاحتوائه ملفًا)
  | Parameter | النوع | إلزامي | الوصف |
  |---|---|---|---|
  | firstName | string | نعم | الاسم الأول |
  | lastName | string | نعم | الاسم الأخير |
  | email | string | نعم | بريد إلكتروني فريد |
  | password | string | نعم | 8 أحرف+ |
  | role | string | نعم | `EVENT_MANAGER` أو `SERVICE_OWNER` فقط |
  | document | file | نعم | PDF/JPG/PNG، حتى 5MB |
- **الوصف:** الحساب يبقى `PENDING_VERIFICATION` حتى يعتمده الأدمن.

## POST `/auth/login`
- **الحماية:** بلا (عام)
- **Body (JSON):**
  | Parameter | النوع | إلزامي |
  |---|---|---|
  | email | string | نعم |
  | password | string | نعم |
- **الوصف:** مسموح حتى لو `PENDING_VERIFICATION`، ممنوع فقط إن كان `REJECTED`. يعيد `accessToken` + بيانات المستخدم.

## POST `/auth/forgot-password`
- **الحماية:** بلا (عام)
- **Body (JSON):**
  | Parameter | النوع | إلزامي |
  |---|---|---|
  | email | string | نعم |
- **الوصف:** يعيد `devOnlyToken` (للاختبار المحلي فقط ⚠️ — استبدله بإرسال بريد حقيقي قبل الإنتاج). صالح لساعة واحدة.

## POST `/auth/reset-password`
- **الحماية:** بلا (عام)
- **Body (JSON):**
  | Parameter | النوع | إلزامي |
  |---|---|---|
  | token | string | نعم | الرمز المستلم من forgot-password |
  | newPassword | string | نعم | 8 أحرف+ |
- **الوصف:** يُستهلك الرمز فور الاستخدام (لا يعمل مرتين).

---

# 2. ملفي الشخصي — `/users`
**الحماية لكل ما يلي:** JWT فقط (أي دور، لحسابك أنت حصرًا).

## GET `/users/me`
- **Parameters:** لا يوجد
- **الوصف:** يعيد بياناتك (بلا `passwordHash`).

## PATCH `/users/me`
- **Body (JSON):**
  | Parameter | النوع | إلزامي |
  |---|---|---|
  | firstName | string | لا |
  | lastName | string | لا |
  | email | string | لا (يتحقق من عدم تكراره) |
- **الوصف:** `role` و`accountStatus` غير قابلين للتعديل من هنا إطلاقًا.

## POST `/users/me/change-password`
- **Body (JSON):**
  | Parameter | النوع | إلزامي |
  |---|---|---|
  | currentPassword | string | نعم |
  | newPassword | string | نعم (8 أحرف+) |

---

# 3. الإدارة — `/admin`
**الحماية لكل ما يلي:** JWT + دور `ADMINISTRATOR` فقط.

## GET `/admin/verification-requests`
- **Query Parameters:**
  | Parameter | النوع | إلزامي | القيم |
  |---|---|---|---|
  | status | string | لا (افتراضي `PENDING`) | `PENDING`\|`APPROVED`\|`REJECTED` |

## GET `/admin/verification-requests/:id/document`
- **Path Parameters:** `id` (رقم — معرّف طلب التحقق)
- **الوصف:** يعرض/يُنزّل مستند الهوية المرفوع مباشرة (Stream، لا JSON).

## POST `/admin/verification-requests/:id/approve`
- **Path Parameters:** `id` (رقم)
- **Body:** لا يوجد

## POST `/admin/verification-requests/:id/reject`
- **Path Parameters:** `id` (رقم)
- **Body (JSON):**
  | Parameter | النوع | إلزامي |
  |---|---|---|
  | reason | string | نعم (5 أحرف+) |

## GET `/admin/services`
- **Parameters:** لا يوجد — يعيد كتالوج أنواع الخدمات كاملاً.

## POST `/admin/services`
- **Body (JSON):**
  | Parameter | النوع | إلزامي |
  |---|---|---|
  | name | string | نعم (2 حرف+) |
  | category | enum | نعم — انظر القسم 9 |
  | description | string | لا |

## PATCH `/admin/services/:id/status`
- **Path Parameters:** `id` (رقم)
- **Body (JSON):**
  | Parameter | النوع | إلزامي | القيم |
  |---|---|---|---|
  | status | string | نعم | `ACTIVE`\|`INACTIVE` |

## GET `/admin/users`
- **Query Parameters:**
  | Parameter | النوع | إلزامي |
  |---|---|---|
  | role | string | لا (`CUSTOMER`\|`EVENT_MANAGER`\|`SERVICE_OWNER`\|`ADMINISTRATOR`) |
  | accountStatus | string | لا (`PENDING_VERIFICATION`\|`APPROVED`\|`REJECTED`) |

## GET `/admin/users/:id`
- **Path Parameters:** `id` (رقم)
- **الوصف:** تفاصيل مستخدم مع منشآته/مناسباته إن وُجدت.

## GET `/admin/businesses`
- **Parameters:** لا يوجد

## PATCH `/admin/businesses/:id/status`
- **Path Parameters:** `id` (رقم)
- **Body (JSON):**
  | Parameter | النوع | إلزامي | القيم |
  |---|---|---|---|
  | status | string | نعم | `ACTIVE`\|`INACTIVE` |

## GET `/admin/events`
- **Query Parameters:**
  | Parameter | النوع | إلزامي |
  |---|---|---|
  | status | string | لا (`CREATED`\|`SUBMITTED`\|`ADOPTED`\|`IN_PROGRESS`\|`COMPLETED`) |
- **الوصف:** مراقبة فقط — لا صلاحية تعديل قرارات مدير المناسبة.

---

# 4. المناسبات — `/events`
**الحماية:** JWT لكل ما يلي، + قيود إضافية موضحة لكل Endpoint.

## GET `/events/available-services`
- **الحماية:** أي دور مسجّل دخول
- **Parameters:** لا يوجد

## GET `/events/service-categories`
- **الحماية:** أي دور مسجّل دخول
- **Parameters:** لا يوجد
- **الوصف:** يعيد `[{ value, label }]` — انظر القسم 9.

## POST `/events`
- **الحماية:** دور `CUSTOMER` + حساب معتمد
- **Body (JSON):**
  | Parameter | النوع | إلزامي |
  |---|---|---|
  | title | string | نعم (3 أحرف+) |
  | description | string | لا |
  | eventDate | string (ISO date) | نعم |
  | location | string | نعم (3 أحرف+) |
  | businessServiceIds | number[] | نعم (عنصر واحد+) |

## GET `/events/requests`
- **الحماية:** دور `EVENT_MANAGER` + حساب معتمد
- **Parameters:** لا يوجد — المناسبات الجديدة غير المتبنّاة.

## GET `/events/open-for-assistant-managers`
- **الحماية:** دور `EVENT_MANAGER` + حساب معتمد
- **Parameters:** لا يوجد

## GET `/events/mine`
- **الحماية:** دور `CUSTOMER` أو `EVENT_MANAGER`
- **Parameters:** لا يوجد — دور-محور تلقائيًا.

## POST `/events/:id/adopt`
- **الحماية:** دور `EVENT_MANAGER` + حساب معتمد
- **Path Parameters:** `id` (رقم المناسبة)
- **Body:** لا يوجد

## POST `/events/:id/close`
- **الحماية:** دور `EVENT_MANAGER` (المدير **الرئيسي** تحديدًا) + حساب معتمد
- **Path Parameters:** `id` (رقم المناسبة)
- **Body:** لا يوجد
- **شرط:** كل `eventServices` يجب أن تكون `COMPLETED`.

## POST `/events/:eventId/services/:eventServiceId/send`
- **الحماية:** دور `EVENT_MANAGER` (مدير هذه المناسبة تحديدًا) + حساب معتمد
- **Path Parameters:** `eventId`، `eventServiceId` (كلاهما رقم)
- **Body:** لا يوجد

## POST `/events/:eventId/services/:eventServiceId/replace-owner`
- **الحماية:** دور `EVENT_MANAGER` + حساب معتمد
- **Path Parameters:** `eventId`، `eventServiceId`
- **Body (JSON):**
  | Parameter | النوع | إلزامي |
  |---|---|---|
  | newBusinessServiceId | number | نعم |
  | reason | string | نعم (5 أحرف+) |

## POST `/events/:eventId/assistant-manager/open`
- **الحماية:** دور `EVENT_MANAGER` (المدير **الرئيسي**) + حساب معتمد
- **Path Parameters:** `eventId`
- **Body (JSON):**
  | Parameter | النوع | إلزامي |
  |---|---|---|
  | slotsNeeded | number | نعم (1 على الأقل) |

## POST `/events/:eventId/assistant-manager/join`
- **الحماية:** دور `EVENT_MANAGER` + حساب معتمد
- **Path Parameters:** `eventId`
- **Body:** لا يوجد — انضمام ذاتي فوري.

## GET `/events/:id`
- **الحماية:** صاحب المناسبة (Customer) أو أحد مدرائها النشطين فقط
- **Path Parameters:** `id`

## GET `/events/:id/activity-log`
- **الحماية:** نفس شرط `GET /events/:id`
- **Path Parameters:** `id`

## GET `/events/:id/decision-log`
- **الحماية:** نفس شرط `GET /events/:id`
- **Path Parameters:** `id`

---

# 5. تنفيذ الخدمات — `/service-requests`
**الحماية لكل ما يلي:** JWT + حساب معتمد.

## GET `/service-requests/mine`
- **الحماية:** دور `SERVICE_OWNER`
- **Query Parameters:**
  | Parameter | النوع | إلزامي | القيم |
  |---|---|---|---|
  | scope | string | لا (افتراضي `pending`) | `pending`\|`active`\|`completed`\|`all` |

## POST `/service-requests/:id/accept`
- **الحماية:** دور `SERVICE_OWNER`
- **Path Parameters:** `id` (رقم — معرّف `ServiceRequest`)
- **Body:** لا يوجد

## POST `/service-requests/:id/reject`
- **الحماية:** دور `SERVICE_OWNER`
- **Path Parameters:** `id`
- **Body (JSON):**
  | Parameter | النوع | إلزامي |
  |---|---|---|
  | reason | string | نعم (5 أحرف+) |

## POST `/service-requests/:id/complete`
- **الحماية:** دور `SERVICE_OWNER`
- **Path Parameters:** `id`
- **Body:** لا يوجد
- **شرط:** الحالة الحالية `IN_PROGRESS` أو `NEEDS_CORRECTION`.

## POST `/service-requests/:id/approve`
- **الحماية:** دور `EVENT_MANAGER`
- **Path Parameters:** `id`
- **Body:** لا يوجد
- **شرط:** الحالة الحالية `WAITING_FOR_VERIFICATION`.

## POST `/service-requests/:id/request-correction`
- **الحماية:** دور `EVENT_MANAGER`
- **Path Parameters:** `id`
- **Body (JSON):**
  | Parameter | النوع | إلزامي |
  |---|---|---|
  | reason | string | نعم (5 أحرف+) |

---

# 6. المنشآت وخدماتها — `/business`
**الحماية لكل ما يلي:** JWT + دور `SERVICE_OWNER` + حساب معتمد.

## POST `/business`
- **Body (JSON):**
  | Parameter | النوع | إلزامي |
  |---|---|---|
  | name | string | نعم (2 حرف+) |
  | phone | string | نعم (6 أحرف+) |
  | address | string | نعم (3 أحرف+) |
  | description | string | لا |

## GET `/business/mine`
- **Parameters:** لا يوجد — كل منشآتك مع خدماتها.

## POST `/business/:businessId/services`
- **Path Parameters:** `businessId`
- **Body (JSON) — خياران:**

  **الخيار أ) ربط بخدمة موجودة:**
  | Parameter | النوع | إلزامي |
  |---|---|---|
  | serviceId | number | نعم |
  | price | number | نعم |
  | description | string | لا |

  **الخيار ب) إنشاء خدمة جديدة تلقائيًا:**
  | Parameter | النوع | إلزامي |
  |---|---|---|
  | serviceName | string | نعم (2 حرف+) |
  | category | enum | نعم — انظر القسم 9 |
  | price | number | نعم |
  | description | string | لا |

## GET `/business/:businessId/services`
- **Path Parameters:** `businessId`

## PATCH `/business/services/:id`
- **Path Parameters:** `id` (رقم — معرّف `BusinessService`)
- **Body (JSON):**
  | Parameter | النوع | إلزامي |
  |---|---|---|
  | price | number | لا |
  | description | string | لا |

## PATCH `/business/services/:id/status`
- **Path Parameters:** `id`
- **Body (JSON):**
  | Parameter | النوع | إلزامي | القيم |
  |---|---|---|---|
  | status | string | نعم | `ACTIVE`\|`INACTIVE` |

---

# 7. الإشعارات — `/notifications`
**الحماية لكل ما يلي:** JWT فقط (لإشعاراتك أنت حصرًا).

## GET `/notifications/mine`
- **Parameters:** لا يوجد

## GET `/notifications/unread-count`
- **Parameters:** لا يوجد — يعيد `{ "count": number }`

## POST `/notifications/:id/read`
- **Path Parameters:** `id`
- **Body:** لا يوجد

## POST `/notifications/read-all`
- **Parameters:** لا يوجد

---

# 8. قيم `category` الثابتة (Enum)
| القيمة (تُرسل للسيرفر) | التسمية العربية |
|---|---|
| PHOTOGRAPHY | تصوير فوتوغرافي |
| CATERING | تقديم الطعام والمشروبات |
| DECORATION | ديكور وتنسيق |
| MUSIC_AND_ENTERTAINMENT | موسيقى وترفيه |
| VENUE | تأجير قاعة أو مكان |
| LIGHTING | إضاءة |
| FURNITURE_AND_SEATING | أثاث وجلسات |
| TRANSPORTATION | نقل وتوصيل |
| SWEETS_AND_DESSERTS | حلويات وتحلية |
| BEAUTY_AND_MAKEUP | تجميل ومكياج |
| PRINTING_AND_INVITATIONS | دعوات وطباعة |
| OTHER | أخرى |

---

# 9. ملخص الأدوار (Roles)
| الدور | كيف يُنشأ |
|---|---|
| `CUSTOMER` | تسجيل ذاتي، مُفعَّل تلقائيًا |
| `EVENT_MANAGER` | تسجيل ذاتي، يحتاج اعتماد إداري |
| `SERVICE_OWNER` | تسجيل ذاتي، يحتاج اعتماد إداري |
| `ADMINISTRATOR` | سكربت طرفية يدوي فقط (`create-admin.ts`) — لا تسجيل عام |

# 10. ملخص دورات الحياة (Status Enums)
- **AccountStatus:** `PENDING_VERIFICATION` → `APPROVED` / `REJECTED`
- **EventStatus:** `CREATED` → `SUBMITTED` → `ADOPTED` → `IN_PROGRESS` → `COMPLETED`
- **EventServiceStatus:** `PENDING_ASSIGNMENT` → `ASSIGNED` → `ACCEPTED`/`REJECTED` → `IN_PROGRESS` → `WAITING_FOR_VERIFICATION` → `COMPLETED` / `NEEDS_CORRECTION` (↩ يعود إلى `IN_PROGRESS`)
