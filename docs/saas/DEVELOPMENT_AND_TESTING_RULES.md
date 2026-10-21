# Oksy Academy — Development & Testing Rules

## Development Philosophy

Changes should be:
- Small
- Understandable
- Reviewable
- Testable
- Reversible where practical

Do not combine unrelated changes.

## Before Implementing a Feature

1. Understand the requirement.
2. Inspect existing implementation.
3. Identify reusable components.
4. Check database implications.
5. Check authentication implications.
6. Check authorization/RLS implications.
7. Identify affected modules.
8. Plan the implementation.
9. Implement.
10. Test.
11. Run lint.
12. Run build.
13. Review for regressions.

## Do Not Break Existing Functionality

Before changing existing functionality, determine:
- What depends on it?
- What pages use it?
- What database queries use it?
- What permissions affect it?
- What tests cover it?

## Testing Strategy

Testing should focus first on business-critical and security-critical functionality.

### Unit Tests

Prioritize:
- Financial calculations
- Validation
- Business rules
- Utility functions
- Data transformations

### Integration Tests

Prioritize:
- Database operations
- Authentication
- Authorization
- RLS
- Important workflows

### End-to-End Tests

Prioritize real user journeys such as:
- Login
- Student creation
- Fee collection
- Expense entry
- Financial dashboard
- Student fee status
- Assignment creation
- Assignment submission
- Faculty workflows
- Admin workflows

### Security Tests

Test:
- Unauthorized access
- Cross-user access
- Wrong-role access
- Unauthorized modification
- Unauthorized deletion

## Quality Gates

Important changes should pass appropriate:
- Tests
- Lint
- Type checks
- Build
- Database migration checks

## Bug Handling

When a bug is reported:
1. Reproduce it.
2. Identify the exact failure.
3. Determine the root cause.
4. Fix the root cause.
5. Add or improve a regression test.
6. Run relevant tests.
7. Run lint/type checks/build as appropriate.
8. Verify the original workflow.
9. Check for related regressions.

Do not simply patch the visible symptom when the underlying cause remains.

## Production Bugs

The system should be designed for:

Detection → Reproduction → Diagnosis → Fix → Test → Deploy → Verify

The goal is rapid diagnosis, not merely rapid coding.

## AI Coding

AI-generated code must follow the existing architecture.

Before generating new patterns, inspect the repository.

Do not create duplicate implementations merely because they are convenient.

Do not delete working code without understanding its purpose.

## Git

Prefer:
- Small commits
- Clear commit messages
- Reviewable changes
- Feature branches where appropriate
- Pull requests for significant changes
- Protected production/main branches where practical

Never commit secrets.

## Documentation

Important architectural decisions should be documented.

Future AI agents should be able to understand the project without relying on historical chat conversations.
