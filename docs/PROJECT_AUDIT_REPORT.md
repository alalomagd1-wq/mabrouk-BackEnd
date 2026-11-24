# Mabrouk Project Documentation Audit Report

**Audit basis:** Current repository working tree, inspected 20 October 2026. This is a read-only, static audit; the report does not claim production verification.

## A. Executive Summary

Mabrouk is an event-management backend intended to connect customers planning events with event managers and service owners. Customers create event requests; managers may adopt events, coordinate service offers, and oversee delivery; service owners respond to assignments; administrators review professional identity documents and manage users, services, and businesses. Assistant event managers can join an event when its manager opens a call.

The repository contains a NestJS/TypeScript backend with a Prisma/MySQL data model, JWT authentication, SMTP email flows, local identity-document storage, administrator approval, event/service workflows, persisted notifications, and event activity/decision histories. The current working tree includes a substantial amount of uncommitted and untracked work, especially around email verification and password-reset protections. Therefore, this report describes the checked-out working tree, not a published release or deployed system.

The project has one Markdown document, an Arabic API reference, and no discovered README, SRS, glossary, business-rules document, ADR, roadmap, ER diagram, or standalone notification/activity rules document. The API reference lists 55 endpoint headings, matching the 55 routes inventoried in controllers, but it is undated and does not provide the broader product decisions and requirements needed to establish which behaviors are formally approved.

Important implementation findings include:

- Customer registration is completed by email verification; professionals also require administrator review. Pending registration data is held separately until email verification.
- The backend implements event/service coordination, professional verification, notifications, and audit-like histories, but no payment, invoicing, payout, refund, or commission flow was found.
- Event detail and log reads do not consistently reject every authenticated role that is not the event customer or an assigned manager. This requires security review and remediation prioritization.
- Email changes are not verified, JWT authorization claims can remain stale until token expiry, and login/forgot-password have no evident application-level throttling.
- API descriptions do not fully establish the true operational state of email delivery, local document storage, database migrations, or production security controls.

## B. Project Structure and Technology Stack

| Area | Evidence and current status |
|---|---|
| Backend framework | NestJS 11 / TypeScript; implemented (`package.json`, `src/app.module.ts`, `src/main.ts`). |
| Frontend | No frontend project or frontend documentation was found in the inspected repository. |
| Database | Prisma 7 with MySQL datasource configuration and MariaDB driver adapter dependencies; schema/client configured. No live database connection was tested. |
| Authentication | Passport JWT and bcrypt password hashing; implemented. JWTs contain role/account-status claims and default to a seven-day lifetime unless configured otherwise. |
| Email | Nodemailer SMTP integration. Configuration is generic SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`); code does not prove that a Gmail account or production SMTP server is configured. |
| File/image storage | Professional identity documents are written to local `uploads/verification-documents`; no cloud object-storage integration was found. Runtime hosting, file permissions, backup, and public exposure were not tested. |
| Validation | `class-validator` DTO validation and a global validation pipe with whitelist behavior (`src/main.ts`). |
| Testing | A focused auth service test suite; `npm test` passed 25 tests. No integration/database test suite was found. |
| Build tooling | Nest CLI, TypeScript, Prisma CLI. `npm run build` was not run during this audit. |
| External integrations | SMTP is implemented in source but not tested against a real provider. No payment gateway or Sham Cash API integration was found. |
| Operational support | Health endpoint checks database connectivity. Event adoption uses in-memory request locks, which are not shared across multiple application instances. |

Project scripts in `package.json` include `start`, `start:dev`, `build`, `test`, `create-admin`, and `email:test`. The latter two were not run because they may modify a database or send email. The Prisma configuration reads `DATABASE_URL`; no `.env` values were inspected.

## C. Product Scope and Business Model

**Observed product purpose:** coordinate event planning and service execution among customers, event managers, service owners, and administrators. Evidence is in [API_Reference.md](../API_Reference.md), the event/business/service-request controllers, and the corresponding Prisma models.

**Supported service categories** in `ServiceCategory` are `PHOTOGRAPHY`, `CATERING`, `DECORATION`, `DANCE_AND_CHOREOGRAPHY`, `MUSIC_AND_ENTERTAINMENT`, `VENUE`, `LIGHTING`, `FURNITURE_AND_SEATING`, `TRANSPORTATION`, `SWEETS_AND_DESSERTS`, `BEAUTY_AND_MAKEUP`, `PRINTING_AND_INVITATIONS`, and `OTHER` (`prisma/schema.prisma:108-123`). Geographic scope and supported event types beyond the general `Event` model are not defined in the documents inspected.

The implemented flow uses a `BusinessService` offer with a price and copies a price onto an `EventService`. This is not evidence of an agreed financial model: no payment, deposit, commission, payout, refund, invoice, or ledger behavior was found. There is no SRS or roadmap from which MVP boundaries or future commitments can be reliably established. Sham Cash is an under-consideration future method per the audit brief, not an implemented integration.

## D. Roles and Permissions

The role enum contains `CUSTOMER`, `EVENT_MANAGER`, `SERVICE_OWNER`, and `ADMINISTRATOR` (`prisma/schema.prisma:27-32`). Authorization is enforced through role guards and, for many operational actions, an approved-account guard.

| Role | Observed ownership and permissions |
|---|---|
| Customer | Registers through the customer route; owns events created under their account; can access their own event and profile operations. Customer email verification results in an `APPROVED` account. |
| Event Manager | A professional account that requires administrator approval. Approved managers can view the manager request queue, adopt events, assign/reassign services, oversee service completion/correction, close events, and participate as primary or assistant manager. |
| Assistant Event Manager | Not a distinct account role. An approved `EVENT_MANAGER` joins through an `EventManagerAssignment` with `ManagerRole.ASSISTANT`; the primary manager opens a call with available slots. Joining is not shown as requiring primary-manager approval. |
| Service Owner | A professional account that requires administrator approval. Owns a `Business`, creates and manages its service offers, and accepts/rejects/completes its assigned service work. |
| Administrator | Role-gated access to professional verification/document review, service catalogue management, user/business/event listings, and related status operations. Admin accounts are created through the manual `create-admin` script, not public registration. |
| Financial/operational roles | No separate finance, payment, or payout role was found. |

The source uses role claims from JWTs and an approved-account guard; account/role changes are not reflected in already-issued tokens until they are refreshed or expire. This differs from a design that requires immediate revocation and should be decided explicitly.

## E. Authentication, Registration, and Account Lifecycle

1. **Customer registration:** `POST /auth/register/customer` accepts `RegisterCustomerDto`, hashes the password, and stores an unverified registration in `PendingRegistration`. It sends a six-digit email verification code. A `User` account is not activated until verification completes.
2. **Professional registration:** `POST /auth/register/professional` accepts professional fields and identity-front/identity-back documents, with an optional business-front document. A pending registration and document paths are stored; email verification is required before an administrator `VerificationRequest` can be reviewed. Professional roles accepted are `EVENT_MANAGER` and `SERVICE_OWNER`.
3. **Email verification:** `POST /auth/verify-email` accepts an email and code. The code is hashed at rest, expires after 10 minutes, is limited to five attempts, and is consumed when the pending registration is converted. Customers are created as `APPROVED`; professionals are created in `PENDING_VERIFICATION` and await a separate administrator decision.
4. **Resend:** `POST /auth/resend-verification-email` enforces a one-minute cooldown and a five-per-24-hour resend window. Responses are designed not to reveal whether a registration exists. Expired pending registrations are eligible for cleanup, including document cleanup.
5. **Login:** `POST /auth/login` requires a verified email. Rejected accounts are denied; pending professionals may receive a JWT, but endpoints guarded by `ApprovedAccountGuard` are restricted. This means email verification and professional approval are distinct gates. There is no separate “pending email” `User` state because pending details are stored in `PendingRegistration`.
6. **Administrator approval:** administrators approve or reject a professional verification request; this updates account/verification state and records review-related activity/notification data. Approval does not replace email verification.
7. **Password reset:** `POST /auth/forgot-password` sends a six-digit code, stored as a hash with an expiry and five-attempt limit. The code lasts one hour and is invalidated after successful reset; unknown addresses receive the same general response. `POST /auth/reset-password` accepts email, code, and new password. A successful reset replaces the password hash and consumes reset state.
8. **Authenticated password change:** `POST /users/me/change-password` is available to an authenticated user and uses the current password plus a new password.
9. **Email changes:** profile update can change the email after uniqueness checks, but does not require verification of the new address. This can change the destination used for password recovery.
10. **Token/security behavior:** verification and reset codes are six-digit numeric codes with hashed storage and attempt limits. JWTs carry role/account status and have no evident immediate revocation mechanism. Application-level login/forgot-password throttling was not found; resend and code-attempt limits are present.
11. **Email templates/URLs:** email content is generated by the email service for verification and reset. The API reference says these are email codes and that no frontend verification URL / `PASSWORD_RESET_URL` is required for these flows. The SMTP configuration is provider-neutral; a Gmail host or real delivery was not verified.
12. **Error disclosure/logging:** forgot-password and resend use generic responses for unknown accounts. SMTP delivery failures are logged and swallowed in the auth service, so the public call can appear successful despite delivery failure. The audit did not find evidence of verification/reset codes being intentionally returned in normal API responses.

The current design is email/SMTP-based, not WhatsApp-based. No WhatsApp, SMS, or WhatsApp OTP references were found in `src`, `package.json`, or `package-lock.json`. The six-digit code is not evidence of SMS delivery.

## F. Account Verification and Administrator Approval

Email verification proves mailbox access; it does not approve a professional. `PendingRegistration` stores pending account details and document paths separately until email verification. On conversion, professional registration creates an account in `PENDING_VERIFICATION` and an administrator review request. The administrator can inspect uploaded documents and approve or reject the professional. Customers do not have the same document-review step.

The schema uses `AccountStatus.PENDING_VERIFICATION`, `APPROVED`, and `REJECTED`, while email verification is represented separately by `emailVerifiedAt`. This terminology can be misleading: a professional can have a verified email while the account remains `PENDING_VERIFICATION` for administrator review. Rejected status is represented, but no `SUSPENDED` account state was found in the enum. Pending professionals can log in, although approved-account guarded operations are blocked.

Uploaded identity files are limited by the registration controller to three files and 5 MB per file, with JPG/PNG checks and signature-byte validation. Admin document retrieval endpoints are JWT/admin-gated. Production storage isolation, retention policy, and access logging were not validated.

## G. Event and Service Workflows

The schema has `Event`, `EventService`, `BusinessService`, `ServiceRequest`, manager assignment/request models, status histories, and event activity/decision logs. No separate `EventPackage` entity was found.

1. A customer creates an event. The service selects available business-service offers, snapshots their prices to event services, creates pending service requests, submits the event, and notifies approved managers.
2. An event manager adopts an event; the manager assignment is primary and the event becomes `ADOPTED`.
3. A manager sends service assignments to service owners. Service owners accept or reject. Accepted work progresses through in-progress and completion states; managers approve completion or request correction.
4. The primary manager may close an event only when its services are completed. Event detail, activity log, and decision log are available through separate routes.
5. A manager can open an assistant-manager call with a slot count. Approved managers can join; joining is guarded by a transaction that decrements capacity and records an assignment/log/notification.
6. A manager can replace a service owner. The source creates a new request for the replacement but does not update the existing event-service price in that path, so price snapshot semantics after replacement are uncertain.

Relevant enums are `EventStatus`: `CREATED`, `SUBMITTED`, `ADOPTED`, `IN_PROGRESS`, `COMPLETED`; `EventServiceStatus`: `PENDING_ASSIGNMENT`, `ASSIGNED`, `ACCEPTED`, `REJECTED`, `IN_PROGRESS`, `WAITING_FOR_VERIFICATION`, `NEEDS_CORRECTION`, `COMPLETED`; and `ServiceRequestStatus`: `PENDING`, `ACCEPTED`, `REJECTED`. The API reference separately describes event/service lifecycle names; the relationship between `ServiceRequestStatus` and `EventServiceStatus` is not fully explained. Cancellation and post-completion changes are not implemented/documented as a complete lifecycle.

Potentially ambiguous vocabulary: “Event Package” and “Event Request” are not separate schema models; an event submission and its service requests appear to represent those concepts. Manager adoption and assistant participation are implemented, but there is no standalone approved workflow specification. The admin event-list endpoint exists, but source evidence does not establish a full administrative event-edit lifecycle.

## H. Business Rules and Architectural Decisions

No ADR or standalone approved business-rules document was found. Accordingly, the following are **observed implementation rules or API-reference statements**, not independently verified owner approvals:

| Rule / decision | Meaning and evidence | Implementation status / uncertainty |
|---|---|---|
| Email before account activation | Registration requires code verification; code lifetime is 10 minutes, five attempts, resend cooldown 60 seconds and five sends per 24 hours (`API_Reference.md:30-67`; `src/auth/auth.service.ts:110-275`). | Implemented and unit tested; operational email delivery unverified. |
| Separate professional approval | Manager and service-owner accounts require document review and admin approval (`API_Reference.md:42-58,132-150`; `src/admin/admin.service.ts:32-119`). | Implemented; approval criteria and SLA are not specified. |
| Customer vs professional account state | Customer becomes `APPROVED` after email verification; professionals remain `PENDING_VERIFICATION` until admin review. | Implemented; the shared status name conflates email verification with professional approval. |
| Service completion review | Managers approve completed service work or request corrections; event closing requires all event services completed (`API_Reference.md:240-249,302-327`). | Implemented; cancellation and changes after close are not specified. |
| Price snapshot | A selected offer price is copied to an event service (`src/events/events.service.ts:35-63`). | Implemented; no price-change, replacement, tax, or payment policy is documented. |
| Assistant manager capacity | Manager sets call slots; joins reduce available slots in a transaction. | Implemented; manager removal, reopening, or concurrency across multiple app instances is not fully specified. |
| Request lock | Event adoption uses a process-local in-memory lock (`src/request-lock/request-lock.service.ts:10-88`). | Implemented with a known single-instance limitation; distributed deployment decision unresolved. |
| Email delivery provider | User requirement identifies Gmail/SMTP as intended. Code configures generic Nodemailer SMTP. | SMTP code exists; actual provider/account/configuration and delivery reliability are unverified. |
| Payment method/model | Sham Cash is under consideration; no confirmed deposit, commission, refund, or distribution policy. | Not implemented; financial decisions remain open. |

## I. Database and Data Model

`prisma/schema.prisma` defines 16 models:

| Model | Responsibility |
|---|---|
| `User` | Active account, role/status, password hash, email verification and password-reset state. |
| `PendingRegistration` | Unverified registration and hashed email code, resend/attempt metadata, and professional document paths. |
| `Event` | Customer-owned event details and lifecycle status. |
| `EventManagerAssignment` | Primary/assistant manager assignment and active/end state. |
| `AssistantManagerRequest` | Request/response records for assistant manager participation. |
| `Business` | Service-owner business profile and active status. |
| `Service` | Shared service catalogue and category/status. |
| `BusinessService` | Business-specific service offer and price. |
| `EventService` | Service selected for an event, its price snapshot and execution status/timestamps. |
| `ServiceRequest` | Assignment request linking an event service to a business service. |
| `DecisionLog`, `ActivityLog` | Event-related decisions and user activity. |
| `Notification` | Persisted notification, read state, and optional related-entity reference. |
| `VerificationRequest` | Professional review status, reviewer, document paths and rejection reason. |
| `EventServiceStatusHistory`, `EventStatusHistory` | Actor-attributed status transitions and optional reason. |

The schema defines 13 enums. In addition to the role/status values listed above, it includes `ManagerRole` (`PRIMARY`, `ASSISTANT`), `ManagerAssignmentStatus` (`ACTIVE`, `ENDED`), `AssistantRequestStatus` (`PENDING`, `APPROVED`, `REJECTED`), `ActiveStatus` (`ACTIVE`, `INACTIVE`), `VerificationStatus` (`PENDING`, `APPROVED`, `REJECTED`), `RelatedEntityType` (`EVENT`, `EVENT_SERVICE`, `USER`), and the 13 service categories listed in section C (`schema.prisma:27-123`).

Important constraints and concerns:

- Explicit unique constraints include `User.email`, `PendingRegistration.email`, and `PendingRegistration.verificationTokenHash`; an expiry index exists on pending registrations.
- No explicit uniqueness constraint was found for assignment pairs or business/service offer pairs, which may permit duplicate relationships unless guarded elsewhere.
- Notification related-entity ID is polymorphic and has no corresponding foreign key.
- Log/notification type values are strings rather than enums.
- Most foreign keys restrict deletes; optional event/reviewer relationships use `SET NULL`; updates cascade.
- No payment, invoice, transaction, payout, or ledger model exists.

There are eight Prisma migration directories. They add the initial schema; assistant-manager capacity; password-reset fields and service-category enum conversion; verification photo fields; phone; email verification and pending registrations; verification attempts; and password-reset attempts. The category-conversion migration warns that existing category values can fail conversion or be lost. The email-verification migration backfills existing users’ `email_verified_at` from `created_at`. Migrations were inspected but not applied; the live database and migration state were not inspected.

No ER diagram or separate database-design document was found for comparison.

## J. API Inventory

The controller inventory contains 55 routes. Every route below is implemented in a controller; request DTOs are named where they are available. Authentication/role requirements are taken from the guards attached to the controller or method. `JWT` means authenticated; `approved` means `ApprovedAccountGuard`.

| Method and route | Purpose / request | Access |
|---|---|---|
| `GET /health` | Database health check. | Public |
| `POST /auth/register/customer` | Customer registration (`RegisterCustomerDto`). | Public |
| `POST /auth/register/professional` | Professional registration and document upload (`RegisterProfessionalDto`, multipart). | Public |
| `POST /auth/verify-email` | Verify registration code (`VerifyEmailDto`). | Public |
| `POST /auth/resend-verification-email` | Resend registration code (`ResendVerificationEmailDto`). | Public |
| `POST /auth/login` | Authenticate and return JWT (`LoginDto`). | Public |
| `POST /auth/forgot-password` | Request reset code (`ForgotPasswordDto`). | Public |
| `POST /auth/reset-password` | Consume reset code/change password (`ResetPasswordDto`). | Public |
| `GET /users/me` | Get own profile. | JWT |
| `PATCH /users/me` | Update own profile (`UpdateProfileDto`). | JWT |
| `POST /users/me/change-password` | Change own password (`ChangePasswordDto`). | JWT |
| `GET /admin/verification-requests` | List/filter professional review requests. | JWT, `ADMINISTRATOR` |
| `POST /admin/verification-requests/:id/approve` | Approve a professional. | JWT, `ADMINISTRATOR` |
| `POST /admin/verification-requests/:id/reject` | Reject (`RejectVerificationDto`). | JWT, `ADMINISTRATOR` |
| `GET /admin/verification-requests/:id/document` | Retrieve verification document. | JWT, `ADMINISTRATOR` |
| `GET /admin/verification-requests/:id/documents/:documentType` | Retrieve selected document type. | JWT, `ADMINISTRATOR` |
| `GET /admin/services` | List service catalogue. | JWT, `ADMINISTRATOR` |
| `POST /admin/services` | Create catalogue service (`CreateServiceCatalogDto`). | JWT, `ADMINISTRATOR` |
| `PATCH /admin/services/:id/status` | Set catalogue active state (`UpdateActiveStatusDto`). | JWT, `ADMINISTRATOR` |
| `GET /admin/users` | List/filter users by role/status. | JWT, `ADMINISTRATOR` |
| `GET /admin/users/:id` | Get user details. | JWT, `ADMINISTRATOR` |
| `GET /admin/businesses` | List businesses. | JWT, `ADMINISTRATOR` |
| `PATCH /admin/businesses/:id/status` | Change business status. | JWT, `ADMINISTRATOR` |
| `GET /admin/events` | List/filter events. | JWT, `ADMINISTRATOR` |
| `GET /events/available-services` | List available service offers. | JWT |
| `GET /events/service-categories` | List service categories. | JWT |
| `POST /events` | Create/submit event (`CreateEventDto`). | JWT, `CUSTOMER` |
| `GET /events/requests` | Manager event request queue. | JWT, approved `EVENT_MANAGER` |
| `GET /events/open-for-assistant-managers` | List events open for assistant participation. | JWT, approved `EVENT_MANAGER` |
| `GET /events/mine` | List events accessible to current account. | JWT |
| `POST /events/:id/adopt` | Adopt event. | JWT, approved `EVENT_MANAGER` |
| `POST /events/:id/close` | Close completed event. | JWT, approved `EVENT_MANAGER` |
| `POST /events/:eventId/services/:eventServiceId/send` | Send service assignment. | JWT, approved `EVENT_MANAGER` |
| `POST /events/:eventId/services/:eventServiceId/replace-owner` | Replace service owner (`ReplaceServiceOwnerDto`). | JWT, approved `EVENT_MANAGER` |
| `POST /events/:eventId/assistant-manager/open` | Open assistant-manager call (`OpenAssistantCallDto`). | JWT, approved `EVENT_MANAGER` |
| `POST /events/:eventId/assistant-manager/join` | Join an open assistant-manager call. | JWT, approved `EVENT_MANAGER` |
| `GET /events/:id` | Get event details. | JWT; service-level checks incomplete for some roles |
| `GET /events/:id/activity-log` | Get event activity history. | JWT; service-level checks incomplete for some roles |
| `GET /events/:id/decision-log` | Get event decision history. | JWT; service-level checks incomplete for some roles |
| `GET /service-requests/mine` | List service owner’s requests (optional scope query). | JWT, approved `SERVICE_OWNER` |
| `POST /service-requests/:id/accept` | Accept service request. | JWT, approved `SERVICE_OWNER` |
| `POST /service-requests/:id/reject` | Reject request (`ReasonDto`). | JWT, approved `SERVICE_OWNER` |
| `POST /service-requests/:id/complete` | Mark work complete. | JWT, approved `SERVICE_OWNER` |
| `POST /service-requests/:id/approve` | Manager approves completed work. | JWT, approved `EVENT_MANAGER` |
| `POST /service-requests/:id/request-correction` | Manager requests correction (`ReasonDto`). | JWT, approved `EVENT_MANAGER` |
| `POST /business` | Create business (`CreateBusinessDto`). | JWT, approved `SERVICE_OWNER` |
| `GET /business/mine` | Get own business. | JWT, approved `SERVICE_OWNER` |
| `POST /business/:businessId/services` | Create offer (`CreateBusinessServiceDto`). | JWT, approved `SERVICE_OWNER` |
| `GET /business/:businessId/services` | List business offers. | JWT, approved `SERVICE_OWNER` |
| `PATCH /business/services/:id` | Update offer (`UpdateBusinessServiceDto`). | JWT, approved `SERVICE_OWNER` |
| `PATCH /business/services/:id/status` | Set offer active state (`UpdateActiveStatusDto`). | JWT, approved `SERVICE_OWNER` |
| `GET /notifications/mine` | List own notifications. | JWT |
| `GET /notifications/unread-count` | Count unread notifications. | JWT |
| `POST /notifications/:id/read` | Mark notification read. | JWT |
| `POST /notifications/read-all` | Mark all own notifications read. | JWT |

The route and method inventory matches the 55 headings in `API_Reference.md` (`API_Reference.md:19-404`). The reference describes DTO fields and expected behavior but is undated; route presence does not establish that all examples, response shapes, authorization details, or validation rules remain current. Notable documented inconsistencies include customer phone length of 7–20 versus professional phone length of 7–10 (`API_Reference.md:37,49`). Query filters are not consistently DTO-validated, and several are passed as strings/cast in service code.

The global validation pipe rejects non-whitelisted DTO fields and applies class-validator constraints (`src/main.ts:17-26`). Authentication returns a JWT and user summary; email-request flows use generic responses; administrator document routes stream file content. Most other success responses are service/model data, and exact serialized response contracts were not verified against a running server. The global exception filter formats HTTP exceptions and masks unhandled failures (`src/common/filters/all-exceptions.filter.ts:27-79`).

## K. Email and External Integrations

- **Email:** Nodemailer SMTP configured by `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (`src/email/email.service.ts:1-31`). Verification and reset messages are generated in the email service. Delivery was not tested against SMTP; auth unit tests use a fake email service.
- **Email URL requirements:** The code/reference use six-digit codes; the API reference says a frontend verification page/URL variable is not required for these endpoints. The email provider’s production configuration and deliverability are unknown.
- **Error handling:** Auth logs email delivery failures and returns the generic outward response, which can make an undelivered code appear to have been sent. No real email was sent during the audit.
- **Storage:** Identity documents are stored on local disk, not a cloud bucket. Production durability, encryption, access controls, and cleanup behavior were not exercised.
- **Other services:** No payment, SMS, WhatsApp, or cloud storage integration was found. Notifications are persisted in the database; no realtime push channel was found.

## L. Security and Privacy Review

Static findings below are evidence-based, not exploit demonstrations. Severity reflects potential impact in the current code; deployment-level controls were not assessed.

| Severity | Finding and evidence | Potential impact / limitation |
|---|---|---|
| **Medium** | Event detail and event-log reads have JWT guards, but service authorization checks do not explicitly reject every other authenticated role (`src/events/events.controller.ts:26-28,118-129`; `src/events/events.service.ts:205-224,253-274`). | An authenticated role outside the intended customer/assigned-manager cases may retrieve event information by ID. Confirm and close the authorization gap. |
| **Medium** | Profile updates can change email without verifying the new address (`src/users/users.service.ts:37-62`). | Account recovery can be redirected to an unverified address and account identity can be misrepresented. |
| **Medium** | JWT carries role/account-status claims; strategy trusts those claims rather than reloading current state (`src/auth/auth.service.ts:576-600`; `src/auth/strategies/jwt.strategy.ts:18-34`). | Rejection/status/role changes may not take effect for already-issued tokens until expiry (default seven days unless configured). |
| **Medium** | No application-level throttling was found on login or forgot-password. Reset and verification attempts are bounded, and resend is limited. | Password guessing or reset-request abuse may be possible absent gateway/deployment controls, which were not inspected. |
| **Medium** | Service-owner actions check event-service ownership/status but not the individual service request status (`src/service-requests/service-requests.service.ts:186-203`). | State transitions may be accepted in circumstances not intended by the request lifecycle; verify behavior and enforce consistent state invariants. |
| **Low–Medium** | Replacement checks whether the new offer is active but not whether its business/catalog service remains active (`src/events/events.service.ts:387-400`). | A replacement may select an offer whose parent entity is inactive. Confirm desired rule and validate all relevant states. |
| **Low** | SMTP failures are logged and swallowed (`src/auth/auth.service.ts:345-359,475-511`). | Registration/reset can appear successful while the email was not delivered; user support and recovery are affected. |
| **Informational / review required** | Identity documents use local filesystem storage; admin retrieval is guarded (`src/auth/auth.controller.ts:32-105`; `src/admin/admin.controller.ts:51-103`). | Runtime web-root exposure, filesystem permissions, retention and backups were not inspected; verify deployment controls. |
| **Informational / review required** | In-memory request lock is single-instance only (`src/request-lock/request-lock.service.ts:10-88`). | Concurrent requests across multiple backend instances are not coordinated. |
| **Informational / review required** | Admin filters and service-request scope use raw query strings and some casts (`src/admin/admin.controller.ts:32-34,123-146`; `src/admin/admin.service.ts:145-166`). | Validate allowed enum values and malformed inputs at the DTO boundary; no direct injection finding was established. |

Password hashing uses bcrypt. Verification and reset codes are hashed and attempt-limited. No deployment configuration, reverse proxy, production log sink, filesystem ACL, backup, or live access policy was assessed; therefore these findings do not certify or condemn production controls.

## M. Financial and Payment Status

Implemented: business-service offers have prices; an event-service may hold a price snapshot. No payment, deposit, invoice, gateway integration, payment transaction, refund, provider payout, commission, settlement, or financial audit-ledger model or migration was found.

Sham Cash is only a method under consideration per the audit brief. There is no evidence of a Sham Cash API integration in source, dependencies, schema, or migrations. The financial model is explicitly unresolved; this report does not infer a deposit percentage, commission, refund policy, or distribution arrangement.

## N. Testing and Verification Results

- `npm test` was executed by the audit and passed: **25 passed, 0 failed**. Tests are in `src/auth/auth.service.spec.ts` and cover registration, verification/resend, and reset behavior using in-memory Prisma/email doubles. They are unit tests, not production or SMTP integration tests.
- `npx prisma validate` was executed and reported a valid schema. No database was accessed.
- `npm run build` was not run. No build status is claimed.
- No migration was applied and no live migration status was checked.
- No test suite for event workflows, authorization, administrator review, migrations, database integration, local-file access, or real email delivery was found.
- No coverage report was available. Test results do not establish deployed behavior.

## O. Documentation Inventory and Consistency Matrix

### Document inventory

| Document and path | Purpose / coverage | Currency and conflicts | Review priority |
|---|---|---|---|
| [API_Reference.md](../API_Reference.md) | Arabic API reference: auth, admin, event, business, service-request, notification endpoints, roles, and status summaries. | Undated/versionless. Its 55 route headings match the controller route inventory. It does not substitute for requirements, glossary, business rules, ADRs, roadmap, database design, or deployment guidance. Some validation/status summaries are ambiguous. | High |
| README/setup guide | Not found. | No installation, environment setup, architecture, or deployment baseline in a README. | High |
| SRS, glossary, business rules, ADRs, roadmap | Not found. | Formal owner-approved requirements and decisions cannot be identified. | High |
| ER/database design, activity/notification rules, frontend docs | Not found. | Schema and implementation have no companion design/behavior documentation. | Medium |

The documentation search discovered **one Markdown documentation file**. The existing report path did not exist; the `docs/` directory was absent at audit start.

### Consistency matrix

| Topic | API reference | Schema/source | Audit assessment |
|---|---|---|---|
| Roles | Four roles listed. | Same four enum values; assistant manager is an assignment role, not a user role. | Aligned; distinguish account role from assignment role in glossary. |
| Email verification | Six-digit email code, expiry/attempt/resend behavior described. | Pending registrations, code hashing, expiry and counters implemented; SMTP failures can be swallowed. | Broadly aligned; operational delivery not verified. |
| Approval | Professional approval is separate from email confirmation. | Verification request and admin actions exist; customer is approved after email verification. | Broadly aligned; shared `PENDING_VERIFICATION` label is semantically ambiguous. |
| Password reset | Six-digit email code, one-hour lifetime, five attempts and generic response. | Hashed reset state and attempt limit implemented. | Broadly aligned; SMTP delivery and production abuse controls unverified. |
| Event lifecycle | Documents adoption, service assignment, completion and event closure. | Event/event-service/request enums separate lifecycle states; status-history models exist. | Broadly aligned but relationships and cancellation/change rules are incomplete. |
| Assistant managers | Open/join routes documented. | Assignment and request models exist; joining decrements capacity transactionally. | Routes align; approvals/removal and multi-instance coordination are unclear. |
| Notifications/activity | Notification and event activity/decision routes documented. | Persisted notification and log models/services exist. | No realtime channel or standalone notification rules document found. |
| WhatsApp/SMS | No WhatsApp reference found; email is documented. | No WhatsApp/SMS references in source/dependency manifests; SMTP email code exists. | No legacy WhatsApp conflict found in inspected material. |
| Financials | Offer prices appear; payment workflow absent. | Price fields only; no financial models/migrations. | No approved financial policy or integration established. |
| API endpoints | 55 endpoint headings. | 55 controller routes inventoried. | Route/method inventory matches; payloads, statuses and access policy need ongoing reconciliation. |

## P. Discrepancies and Recommended Actions

| ID | Issue | Evidence / impact | Type and priority | Recommended next step / dependency |
|---|---|---|---|---|
| AUD-001 | Event reads/logs may not reject authenticated users outside intended event participants. | Event service authorization checks are incomplete for other roles; potential cross-account disclosure. | Implementation/security; **High priority** | Confirm intended viewer matrix, add explicit deny-by-default checks, and add role/ownership tests. |
| AUD-002 | No formal requirements and decision baseline exists. | Only `API_Reference.md` found; no SRS, glossary, business rules, ADRs, roadmap, or ERD. | Documentation/governance; **High** | Project owner approves product scope and terminology before downstream document reconciliation. |
| AUD-003 | Email address changes are not reverified. | `users.service.ts` changes email after uniqueness check only. | Implementation/security; **High** | Decide whether email change requires verification and recovery lockout; then specify and test. |
| AUD-004 | JWT role/status claims can remain stale. | JWT strategy trusts claims; token lifetime defaults to seven days. | Security/architecture; **High** | Decide acceptable revocation latency; consider current-user lookup or token-version/revocation mechanism. |
| AUD-005 | Login and password-reset requests lack evident app-level throttling. | No application throttler found; reset attempts/resend are bounded separately. | Security; **High** | Confirm deployment rate limiting; add application controls and tests if no reliable gateway control exists. |
| AUD-006 | API reference is undated and has no versioning process. | The 55 routes match, but documentation has no release/version marker and other request/response details may drift. | Documentation; **Medium** | Establish ownership/versioning and add API contract checks or a published OpenAPI source. |
| AUD-007 | Account status conflates email verification and professional approval. | `PENDING_VERIFICATION` persists after professional mailbox verification; a separate `emailVerifiedAt` exists. | Requirements/schema/documentation; **Medium** | Approve distinct state semantics and update glossary, state diagrams, API docs, schema only after decision. |
| AUD-008 | Event, event-service, and service-request states are not one clearly documented state machine. | Separate enums and transition behavior; cancellation and post-completion change rules absent. | Missing requirement; **Medium** | Define allowed transitions, actors, cancellation, corrections, and closure before revising docs/code. |
| AUD-009 | Replacement service-owner price semantics are unclear. | Replacement creates a new request but does not update event-service price in the observed path. | Product/implementation; **Medium** | Decide whether original snapshot is retained or new price is accepted; add a regression test. |
| AUD-010 | Relational uniqueness/integrity constraints may not prevent duplicate assignments/offers. | No explicit unique pair constraints on manager/event assignments or business/service offers. | Data integrity; **Medium** | Confirm duplicate policy and concurrent creation paths; add constraints and migration only after review. |
| AUD-011 | Email delivery errors are hidden behind generic success responses. | Auth logs and swallows SMTP failures. | Reliability/documentation; **Medium** | Preserve anti-enumeration behavior while defining retry/monitoring/support handling for failed delivery. |
| AUD-012 | In-memory adoption lock is not distributed. | Request-lock service documents single-instance limitation. | Architecture/operational; **Medium** | Decide deployment topology; use shared locking/transactional invariant if horizontally scaled. |
| AUD-013 | No payment/financial specification or implementation. | No finance models, migrations, API endpoints, or gateway dependencies; only prices. | Missing requirement/unresolved decision; **Medium** | Owner/legal/finance approval required before designing payment integration or describing financial policy. |
| AUD-014 | Production privacy controls for identity documents are unverified. | Local filesystem storage; only admin routes are evident in source. | Security/operations; **Medium** | Verify deployment exposure, encryption, ACLs, retention/deletion, backups, and audit access. |
| AUD-015 | Existing repository state is substantially dirty. | Many modified tracked files and untracked migrations/auth/email files; `HEAD` is `21b91b1 Initial clean upload`. | Audit/provenance; **Informational** | Review changes with their author and record the intended baseline before release; this audit did not alter them. |

## Q. Questions Requiring the Project Owner's Decision

### Product/business

- What event types, geographic coverage, languages, and MVP boundaries are approved?
- Are “Event Package” and “Event Request” formal product entities, or simply event submission plus service requests?
- Who may view event details, logs, and open assistant-manager calls?
- What are the cancellation, rescheduling, correction, post-completion change, and manager-removal rules?
- Should a professional’s email be verified before or after document review, and what should the account state be called during review?

### Security

- Should administrators be able to immediately revoke existing sessions after rejection, role change, or account status change?
- Must email changes require verification before replacing the recovery address?
- What are the required login/reset IP/account rate limits and monitoring controls?
- What are identity-document retention/deletion periods and production storage/access requirements?

### Financial/legal

- Is Sham Cash approved, and what legal, provider, or compliance prerequisites apply?
- What payment, deposit, commission, provider payout, cancellation, refund, tax, and dispute policies are approved? None should be inferred from current price fields.

### Architecture

- Will the service run as a single instance or horizontally scaled deployment, and what locking/storage/email reliability guarantees are required?
- Should notifications remain database-only, or is realtime/email/push delivery required?
- What is the intended production database and migration deployment/rollback process?

### Documentation

- Who owns the requirements, API, glossary, and release notes?
- Should the API reference remain Arabic, gain an English version, or be generated from an OpenAPI contract?
- Which document is authoritative when implementation and API behavior diverge?

## R. Recommended Documentation Update Plan

1. **Owner decisions first:** resolve product scope, roles and state names, event/service transitions, data visibility, security expectations, email policy, deployment shape, and financial boundaries. Do not document undecided financial terms as commitments.
2. **Create the requirements baseline:** write/approve SRS or product requirements and a glossary; record each approved business rule, role, state, and workflow. These become the source of truth for later documents.
3. **Record architecture decisions:** add ADRs for authentication/session revocation, SMTP delivery, local vs managed document storage, distributed locking, notification delivery, and database/deployment strategy.
4. **Reconcile data design:** create/update ERD and schema documentation from the approved requirements; review uniqueness, foreign-key, retention, and status-history decisions before any schema changes.
5. **Reconcile API reference:** verify every route, DTO, response, guard, status, error, and upload limit against controllers and tests. Add a date/version and define change ownership.
6. **Document operations/security:** add setup/deployment requirements, environment-variable names (never values), email/storage behavior, data retention, monitoring, backup, and operational runbooks.
7. **Update activity/notification and roadmap documents:** specify which actions create records/notifications, delivery channels, and which explicitly deferred features remain outside MVP.
8. **Verify consistency continuously:** add API/schema/test checks where practical and review docs alongside changes. No documents or code were updated as part of this audit.

## Audit Scope and Limitations

The audit reviewed one project Markdown document, 42 application source files directly read, the Prisma schema and eight migrations, auth tests, package scripts, and relevant configuration. Route searches covered controllers and relevant services. Git status/history were inspected. The working tree was already dirty; findings describe that state and may include work not present in `HEAD`.

The audit did **not** inspect `.env` values, access a database, apply migrations, send real email, trigger external services, exploit vulnerabilities, run an application deployment, or verify frontend behavior. The real SMTP provider, database migration state, production storage/privacy controls, deployment-level rate limits, and production behavior remain unverified.
