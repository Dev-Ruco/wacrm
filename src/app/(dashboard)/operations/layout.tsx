import { CatalogWorkspaceNav } from '@/components/catalog/catalog-workspace-nav';

export default function OperationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:gap-0">
      <CatalogWorkspaceNav active="operations" />
      <main className="min-w-0 flex-1 lg:pl-6">{children}</main>
    </div>
  );
}
