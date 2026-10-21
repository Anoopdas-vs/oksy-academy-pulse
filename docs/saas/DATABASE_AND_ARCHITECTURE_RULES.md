# Oksy Academy — Database & Architecture Rules

## General Principle

The database and application architecture must support long-term growth.

The application is expected to evolve from a financial console into a broader academy management platform.

## Existing System First

Before changing the database:
1. Inspect the existing schema.
2. Understand relationships.
3. Inspect migrations.
4. Inspect queries.
5. Inspect RLS.
6. Identify existing data.
7. Identify dependencies.
8. Determine migration risks.

Never assume the current database is wrong simply because it was created by a beginner.

## Database Design

Prefer:
- Clear table names
- Clear column names
- Primary keys
- Foreign keys
- Appropriate constraints
- Unique constraints
- Check constraints
- Appropriate indexes
- Referential integrity
- Explicit relationships
- Timestamps where appropriate
- Auditing where required

Avoid:
- Duplicate sources of truth
- Unnecessary duplicated data
- Hardcoded IDs
- Uncontrolled JSON structures
- Missing foreign keys
- Unnecessary tables
- Destructive migrations
- Unclear ownership relationships

## Every New Table

Evaluate:
- Primary key
- Foreign keys
- Nullability
- Unique constraints
- Check constraints
- Indexes
- RLS
- SELECT policy
- INSERT policy
- UPDATE policy
- DELETE policy
- Audit requirements
- Ownership/security boundary

## Queries

Queries should be:
- Correct
- Secure
- Efficient
- Understandable
- Reusable where appropriate

Avoid unnecessary repeated queries.

Investigate potential:
- N+1 queries
- Large unbounded queries
- Missing indexes
- Unnecessary joins
- Duplicate requests

## Architecture

The application should have clear boundaries between:
- UI
- Components
- Business logic
- Data access
- Validation
- Authentication
- Authorization
- Database

Do not over-engineer.

The architecture should be professional without becoming unnecessarily complicated.

## Reuse

Before creating components, hooks, utilities, queries, services, or validation logic, check whether an existing suitable implementation already exists.

## Migration Philosophy

Prefer:
- Incremental migrations
- Reversible changes where practical
- Data-preserving migrations
- Tested migrations

Avoid:
- Dropping production tables casually
- Removing columns without migration planning
- Changing data types without understanding existing data
- Large uncontrolled schema rewrites

## Performance

Evaluate:
- Indexes
- Query plans
- Pagination
- Data volume
- Payload size
- Repeated requests
- Caching opportunities

Performance improvements must be evidence-based.

## Future Growth

The architecture should allow future modules such as:
- Students
- Courses
- Batches
- Faculty
- Fees
- Finance
- Classes
- Assignments
- Exams
- Timetables
- Notifications
- Administration

without requiring a complete rewrite.
