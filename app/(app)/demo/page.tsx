import { requirePageUser } from "@/lib/auth";
import { JudgeDemo } from "@/components/ll/judge-demo";

export const metadata = { title: "Judge demo · LifeLine" };

export default async function DemoPage() {
  await requirePageUser();
  return (
    <>
      <p className="ll-eyebrow">For the judging panel</p>
      <h1 className="ll-h1">Both advanced challenges in one minute</h1>
      <JudgeDemo />
    </>
  );
}
