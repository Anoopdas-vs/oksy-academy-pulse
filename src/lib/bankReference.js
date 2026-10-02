// Display / search helpers for the bank reference (UTR / bank text) stored in
// bank_reference on collections, expenses and transfers. Read-only: nothing
// here writes the column.

// The UTR to show prominently: the longest run of 9+ digits in the text
// (first one wins a tie). Returns "" when there is none.
export function extractUtr(text) {
  const runs = String(text ?? "").match(/\d{9,}/g);
  if (!runs) return "";
  return runs.reduce((best, r) => (r.length > best.length ? r : best), "");
}

export const EXPENSE_SEARCH_FIELDS = ["category", "account", "description", "reference", "bank_reference"];
export const TRANSFER_SEARCH_FIELDS = ["from_account", "to_account", "purpose", "reference", "note", "bank_reference"];

// Download-template headers. "Bank Reference" is read-only: the import
// parsers never read it, so uploading a template can't blank an existing value.
export const FEE_TEMPLATE_HEADERS = ["Receipt No", "Student ID", "Date", "Type", "Payment A/C", "Amount", "Reference", "Bank Reference"];
export const TRANSFER_TEMPLATE_HEADERS = ["Date", "From Account", "To Account", "Amount", "Purpose", "Reference", "Note", "Bank Reference"];
