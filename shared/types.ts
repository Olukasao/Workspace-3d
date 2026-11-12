/**
 * Tipos compartilhados entre servidor e cliente. Unidade: metros. Eixo Y para cima. Frente de um asset = +Z.
 */

export type Role = 'admin' | 'operator' | 'viewer';

/** Tipo funcional do objeto. As capacidades dependem DESTE campo e do vínculo validado no servidor — nunca do nome da malha. */
export type ObjectKind = 'room' | 'wall' | 'opening' | 'desk' | 'workstation' | 'printer' | 'tv' | 'furniture' | 'decor';

export const OBJECT_KINDS: readonly ObjectKind[] = ['room', 'wall', 'opening', 'desk', 'workstation', 'printer', 'tv', 'furniture', 'decor'];

export type MountType = 'floor' | 'wall' | 'surface';
export type FloorFinish = 'wood' | 'carpet' | 'concrete' | 'tile' | 'plain';
export type WallStyle = 'solid' | 'glass' | 'partition';
export type OpeningStyle = 'door' | 'glassDoor' | 'window';

/** Transformação local (relativa ao pai, ou ao andar quando não há pai). */
export interface Transform {
  x: number;
  y: number;
  z: number;
  /** Rotação em torno de Y, em radianos. */
  rotY: number;
}

export interface RoomProps {
  /** Largura (X) e profundidade (Z) em metros. O transform é o centro da sala. */
  w: number;
  d: number;
  sector?: string;
  capacity?: number;
  floor: FloorFinish;
}

export interface WallProps {
  /** Comprimento ao longo do X local. O transform é o centro da base. */
  length: number;
  height: number;
  thickness: number;
  style: WallStyle;
  /** Parede gerada junto com a sala (lado), reposicionada quando a sala muda de tamanho. */
  side?: 'n' | 's' | 'e' | 'w';
}

export interface OpeningProps {
  /** Vão em uma parede (o pai precisa ser uma parede). t.x = deslocamento ao longo da parede, t.y = peitoril. */
  width: number;
  height: number;
  style: OpeningStyle;
}

/** Instância na cena. O `id` é estável: trocar o modelo visual (assetId) preserva vínculos e integrações. */
export interface SceneObject {
  id: string;
  kind: ObjectKind;
  name: string;
  /** AssetDefinition que desenha o objeto (ausente em sala/parede/vão, que são paramétricos). */
  assetId?: string;
  parentId?: string | null;
  floorId: string;
  t: Transform;
  locked?: boolean;
  groupId?: string | null;
  /** Rótulo livre de material/acabamento (decoração). */
  material?: string;
  /**
   * Mesa de trabalho: ponto fixo de assento (relativo à mesa). Ausente = cadeira filha da mesa ou, sem cadeira,
   * 0,72 m à frente da mesa olhando para ela. É onde o colaborador vinculado "fica" no escritório (e onde o avatar senta).
   */
  seatAnchor?: { x: number; z: number; rotY: number };
  room?: RoomProps;
  wall?: WallProps;
  opening?: OpeningProps;
}

export interface SceneDoc {
  schema: 1;
  units: 'm';
  floorId: string;
  objects: SceneObject[];
}

/** Definição de asset: um GLB pode alimentar muitas instâncias. */
export interface AssetDefinition {
  id: string;
  /** null = catálogo global aprovado; caso contrário, upload da empresa. */
  companyId: string | null;
  slug: string;
  name: string;
  category: string;
  defaultKind: ObjectKind;
  mount: MountType;
  /** Caminho servido localmente (/assets/models/... ou /api/assets/file/...). */
  url: string;
  thumbUrl: string | null;
  fileHash: string;
  fileBytes: number;
  /** Dimensões em metros (X, Z, Y). */
  width: number;
  depth: number;
  height: number;
  /** Altura do tampo onde outros objetos apoiam (null = não é superfície de apoio). */
  surfaceHeight: number | null;
  /** 'base-center' (apoia no piso/superfície) ou 'wall-back' (âncora no centro da face traseira). */
  pivot: 'base-center' | 'wall-back';
  triangles: number;
  license: string;
  author: string;
  sourceUrl: string;
  attribution: string;
  origin: 'download' | 'procedural' | 'upload';
  version: number;
  status: 'approved' | 'pending';
}

export interface OfficeInfo {
  id: string;
  name: string;
  companyId: string;
  building: { id: string; name: string };
  floor: { id: string; name: string; level: number };
  draftVersion: number;
  publishedRevision: { id: string; number: number; publishedAt: number; publishedBy: string } | null;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  companyId: string;
  companyName: string;
  employeeId: string | null;
}

// ---------- visão operacional ----------

export type ActionId = 'chat' | 'remote' | 'transfer' | 'print' | 'printQueue' | 'dashboard' | 'cad';

/** Estado de disponibilidade de uma ação para o usuário atual (calculado no servidor). */
export type ActionAvailability = 'available' | 'not_configured' | 'forbidden' | 'unavailable';

export interface ActionState {
  state: ActionAvailability;
  /** Explicação curta para a interface. */
  reason?: string;
  /** 'demo' = simulado, 'real' = serviço externo configurado. */
  mode: 'demo' | 'real';
}

export type SeatState = 'vacant' | 'occupied' | 'orphan';
export type PresenceState = 'available' | 'busy' | 'away' | 'offline';

export interface EmployeePublic {
  id: string;
  name: string;
  department: string;
  extension: string;
}

export interface OperationalObject {
  objectId: string;
  kind: ObjectKind;
  name: string;
  roomId: string | null;
  seat?: { state: SeatState; employee?: EmployeePublic; note?: string };
  /** Posição fixa: a mesa do colaborador e o ponto de assento dela no mundo (metros). */
  seatPosition?: { deskId: string; deskName: string; x: number; z: number; rotY: number };
  /** Presença: 'unknown' quando o provedor está indisponível; ausente quando o perfil não pode ver. */
  presence?: { state: PresenceState | 'unknown'; mode: 'demo' | 'real' };
  device?: { state: 'linked' | 'orphan' | 'none'; id?: string; name?: string; deviceKind?: string; location?: string };
  dashboard?: { name: string } | null;
  actions: Partial<Record<ActionId, ActionState>>;
}

export interface OperationalView {
  office: OfficeInfo;
  revision: { id: string; number: number; publishedAt: number } | null;
  doc: SceneDoc | null;
  objects: Record<string, OperationalObject>;
  integrations: IntegrationStatus[];
}

export interface IntegrationStatus {
  id: 'chat' | 'presence' | 'remote' | 'transfer' | 'print' | 'cad';
  label: string;
  mode: 'demo' | 'real';
  state: 'ok' | 'not_configured' | 'unavailable';
  detail?: string;
}

export interface AuditEntry {
  id: string;
  actorName: string;
  actorRole: Role;
  action: string;
  targetType: string;
  targetId: string;
  objectId: string | null;
  result: string;
  mode: 'demo' | 'real';
  correlationId: string;
  createdAt: number;
  detail?: Record<string, unknown>;
}

export interface ApiError {
  error: string;
  message: string;
  correlationId?: string;
  [extra: string]: unknown;
}
