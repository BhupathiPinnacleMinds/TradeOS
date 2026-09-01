export type CustomerDisplaySource = {
  companyName?: string | null;
  displayName?: string | null;
};

export function primaryCustomerName(customer: CustomerDisplaySource) {
  return (
    customer.displayName?.trim() || customer.companyName?.trim() || 'Customer'
  );
}

export function secondaryCustomerCompany(customer: CustomerDisplaySource) {
  const companyName = customer.companyName?.trim();
  if (!companyName) return null;
  return companyName === customer.displayName?.trim() ? null : companyName;
}
