import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";
const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n / 100);
export default function HistoryChart({
  history,
  target,
}: {
  history: any[];
  target: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart
        data={history}
        margin={{ left: 5, right: 10, top: 10, bottom: 10 }}
      >
        <XAxis
          dataKey="observed"
          tickFormatter={(v) =>
            new Date(v * 1000).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })
          }
          minTickGap={50}
          tick={{ fill: "#a7a198", fontSize: 12 }}
        />
        <YAxis
          domain={["auto", "auto"]}
          tickFormatter={money}
          tick={{ fill: "#a7a198", fontSize: 12 }}
          width={65}
        />
        <Tooltip
          labelFormatter={(v) =>
            new Date(Number(v) * 1000).toLocaleDateString()
          }
          formatter={(v: any) => money(v)}
          contentStyle={{
            background: "#242019",
            border: "1px solid #494033",
            borderRadius: 10,
          }}
        />
        <Area
          dataKey="price"
          stroke="#f4b94f"
          fill="#b7802426"
          isAnimationActive={false}
        />
        <ReferenceLine y={target} stroke="#8e9c82" strokeDasharray="4 4" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
