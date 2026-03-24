export const SHOT_FIELDS = [
  "角色",
  "场景",
  "动作/事件",
  "镜头语言",
  "情绪/氛围",
  "风格/画质"
] as const;

export type ShotField = (typeof SHOT_FIELDS)[number];

export type StoryboardShot = {
  index: number;
  fields: Record<ShotField, string>;
  text: string;
};

const FIELD_PATTERN = /^【(角色|场景|动作\/事件|镜头语言|情绪\/氛围|风格\/画质)】\s*(.*)$/;

function makeEmptyFields(): Record<ShotField, string> {
  return {
    角色: "",
    场景: "",
    "动作/事件": "",
    镜头语言: "",
    "情绪/氛围": "",
    "风格/画质": ""
  };
}

function shotTextFromFields(fields: Record<ShotField, string>): string {
  return SHOT_FIELDS.map((k) => `【${k}】${fields[k]}`).join("\n");
}

function hasAllFields(fields: Record<ShotField, string>): boolean {
  return SHOT_FIELDS.every((k) => fields[k].trim().length > 0);
}

export function parseStoryboard(raw: string, maxShots = 5): StoryboardShot[] {
  const lines = raw.split(/\r?\n/);
  const shots: StoryboardShot[] = [];
  let current = makeEmptyFields();

  const pushCurrent = () => {
    if (!hasAllFields(current)) return;
    shots.push({ index: shots.length + 1, fields: { ...current }, text: shotTextFromFields(current) });
    current = makeEmptyFields();
  };

  let i = 0;
  while (i < lines.length && shots.length < maxShots) {
    const line = lines[i]?.trim() || "";
    const m = line.match(FIELD_PATTERN);
    if (!m) {
      i += 1;
      continue;
    }

    const key = m[1] as ShotField;
    const inlineValue = (m[2] || "").trim();

    if (key === "角色" && current.角色.trim().length > 0) pushCurrent();

    const valueParts: string[] = [];
    if (inlineValue) valueParts.push(inlineValue);

    i += 1;
    while (i < lines.length) {
      const next = lines[i]?.trim() || "";
      if (FIELD_PATTERN.test(next)) break;
      if (next.length > 0) valueParts.push(next);
      i += 1;
    }

    current[key] = valueParts.join(" ").trim();

    if (hasAllFields(current)) pushCurrent();
  }

  if (shots.length < maxShots) pushCurrent();

  if (shots.length === 0) {
    const fallback = makeEmptyFields();
    fallback["角色"] = "待补充";
    fallback["场景"] = "待补充";
    fallback["动作/事件"] = raw.trim().slice(0, 100) || "待补充";
    fallback["镜头语言"] = "中景";
    fallback["情绪/氛围"] = "自然";
    fallback["风格/画质"] = "清晰";
    return [{ index: 1, fields: fallback, text: shotTextFromFields(fallback) }];
  }

  return shots.slice(0, maxShots);
}
