import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Payee",
  description: "Every payout to one address across payroll runs and chains, with live CCIP delivery status",
});

export default function PayeeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
