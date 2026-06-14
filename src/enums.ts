export type ApiEnumValue = string | number | boolean | null | undefined;

export const enumApiValues: Record<string, Record<string, number>> = {
  genderId: {
    Man: 0,
    Woman: 1,
    NonBinary: 2
  },
  genderPreferences: {
    Men: 0,
    Women: 1,
    NonBinaryPeople: 2
  },
  children: {
    OpenToChildren: 1,
    DontWantChildren: 2,
    HaveChildren: 3,
    PreferNotToSay: 0,
    OpenToAll: 0
  },
  drinking: {
    Yes: 1,
    Sometimes: 2,
    No: 3,
    PreferNotToSay: 0,
    OpenToAll: 0
  },
  drugs: {
    Yes: 1,
    Sometimes: 2,
    No: 3,
    PreferNotToSay: 0,
    OpenToAll: 0
  },
  marijuana: {
    Yes: 1,
    Sometimes: 2,
    No: 3,
    PreferNotToSay: 0,
    OpenToAll: 0
  },
  smoking: {
    Yes: 1,
    Sometimes: 2,
    No: 3,
    PreferNotToSay: 0,
    OpenToAll: 0
  },
  politics: {
    Liberal: 1,
    Moderate: 2,
    Conservative: 3,
    Other: 4,
    PreferNotToSay: 0,
    OpenToAll: 0
  },
  religions: {
    Agnostic: 1,
    Atheist: 2,
    Buddhist: 3,
    Catholic: 4,
    Christian: 5,
    Hindu: 6,
    Jewish: 7,
    Muslim: 8,
    Spiritual: 9,
    Other: 10,
    PreferNotToSay: 0,
    OpenToAll: 0
  },
  ethnicities: {
    Asian: 1,
    Black: 2,
    HispanicLatino: 3,
    MiddleEastern: 4,
    NativeAmerican: 5,
    PacificIslander: 6,
    White: 7,
    Other: 8,
    PreferNotToSay: 0,
    OpenToAll: 0
  },
  relationshipTypes: {
    Monogamy: 1,
    NonMonogamy: 2,
    FiguringItOut: 3,
    PreferNotToSay: 0,
    OpenToAll: 0
  },
  datingIntentions: {
    LifePartner: 1,
    LongTerm: 2,
    LongTermOpenShort: 3,
    ShortTermOpenLong: 4,
    ShortTerm: 5,
    FiguringOut: 6,
    PreferNotToSay: 0,
    OpenToAll: 0
  },
  educationAttained: {
    HighSchool: 1,
    Undergraduate: 2,
    Postgraduate: 3,
    PreferNotToSay: 0,
    OpenToAll: 0
  }
};

export function toApiEnumValue(field: string, value: ApiEnumValue): ApiEnumValue {
  if (typeof value !== "string") {
    return value;
  }
  return enumApiValues[field]?.[value] ?? value;
}

export function toApiEnumArray(field: string, values: unknown): unknown {
  if (!Array.isArray(values)) {
    return values;
  }
  return values.map((value) => toApiEnumValue(field, value as ApiEnumValue));
}
