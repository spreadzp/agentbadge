export interface Category {
  id: string;
  name: string;
  description?: string;
}

export interface Skill {
  id: string;
  name: string;
  category: string;
}

export interface Evidence {
  type: string;
  name: string;
  url?: string;
  description?: string;
}

export type CapabilityStatus = "REQUESTED" | "DECLARED" | "VERIFIED" | "DEPRECATED" | "ARCHIVED";

export interface Capability {
  id: string;
  name: string;
  category: string;
  description?: string;
  skills: string[];
  services: string[];
  people: string[];
  evidence: Evidence[];
  related_articles?: string[];
  related_capabilities?: string[];
  status: CapabilityStatus;
  confidence: number;
}

export interface Service {
  id: string;
  name: string;
  problem: string;
  deliverables: string[];
  engagement: string[];
  contact: string;
}

export interface Person {
  id: string;
  name: string;
  roles: string[];
  capabilities: string[];
  engagement: string[];
  availability: string;
  contact: {
    primary: string;
    channels: string[];
  };
}

export interface RegistryIndex {
  schema_version: string;
  categories: Category[];
  skills: Skill[];
  capabilities: Capability[];
  services: Service[];
  people: Person[];
  warnings: string[];
}
