export type Row = Record<string, any>;
export type Rule = Row & {
  id: string;
  destination_id: string;
  kind: 'fixed' | 'percent';
  value: number;
  verified: number;
};
