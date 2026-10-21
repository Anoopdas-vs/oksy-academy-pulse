# Oksy Academy — Security Requirements

Security is a first-class requirement of the application.

The application may eventually contain sensitive academy, student, faculty and financial information.

## Core Principle

Never rely on frontend UI restrictions as the primary security mechanism.

A user hiding a page, button or menu does NOT constitute authorization.

Authorization must be enforced at the appropriate backend/database level.

## Authentication

Audit the complete authentication implementation.

Determine:
- How users authenticate
- How sessions are managed
- What happens when a session expires
- How protected routes work
- How logout works
- Whether authentication can be bypassed
- Whether sensitive operations require appropriate authentication

## Authorization

The system should eventually support role-based access.

Potential roles include:
- Super Admin
- Academy Admin
- Finance/Admin Staff
- Faculty
- Student
- Other staff roles

Do not assume these roles are final.

Design authorization so it can evolve.

## Data Access

A user must only be able to access data they are authorized to access.

Pay particular attention to:
- User IDs
- Academy/organization ownership
- Student records
- Faculty records
- Financial records
- Course records
- Assignments
- Exams
- Files
- Reports

## Supabase RLS

Audit every relevant table.

For each table determine:
- Is RLS enabled?
- Who can SELECT?
- Who can INSERT?
- Who can UPDATE?
- Who can DELETE?
- Can users access another user's data?
- Can users modify records they do not own?
- Can a lower-privilege role escalate privileges?
- Are policies based on trustworthy database-side information?

Do not assume that the existence of an RLS policy means the table is secure.

## Secrets

Never commit:
- Passwords
- API keys
- Service-role keys
- Private tokens
- Production credentials
- Database credentials
- Other secrets

Check Git history where appropriate if there is evidence that secrets may previously have been committed.

## Environment Variables

Separate development and production configuration appropriately.

Client-exposed variables must be treated as public.

Never put a secret into a frontend-exposed environment variable.

## Database Security

Review:
- Grants
- RLS
- Functions
- Triggers
- RPCs
- SECURITY DEFINER functions
- Search paths
- Privilege boundaries
- Storage policies

## Storage

If Supabase Storage is used, audit:
- Buckets
- Public/private configuration
- Upload policies
- Download policies
- File ownership
- File type validation
- File size restrictions

## Input Validation

Validate user-controlled input at the appropriate boundary.

Do not assume frontend validation is sufficient.

## Security Testing

Important security tests should include:
- Unauthenticated access
- Unauthorized role access
- Cross-user data access
- Cross-academy data access where applicable
- Privilege escalation
- Unauthorized modification
- Unauthorized deletion
- Direct API/database access bypassing the UI

## Security Philosophy

The target is not to claim "perfect security."

The target is to:

PREVENT → DETECT → CONTAIN → DIAGNOSE → FIX → VERIFY → RECOVER
