import { getCandidatesData } from "@/lib/candidate-queries";
import { AppHeader } from "@/components/app-header";
import { CandidatesRoute } from "@/components/candidates-route";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const data = await getCandidatesData();

  return (
    <div className="flex min-h-dvh flex-1 flex-col lg:h-dvh lg:overflow-hidden">
      <AppHeader active="products" />
      <div className="flex flex-1 flex-col p-4 sm:p-6 lg:overflow-y-auto">
        <CandidatesRoute
          rows={data.rows}
          batches={data.batches}
          focus={data.focus}
          now={new Date()}
        />
      </div>
    </div>
  );
}
