interface LanRoom {
  roomCode: string;
  endpoint: string;
  host: string;
  port: number;
  approvalRequired: true;
}

interface LanNetwork {
  interfaceName: string;
  address: string;
  subnet: string;
}

interface AncientBeastDesktopApi {
  lan: {
    supported: true;
    getNetworks(): Promise<LanNetwork[]>;
    startHost(): Promise<{ endpoint: string; port: number }>;
    stopHost(): Promise<void>;
    setAdvertisedRoom(room: { roomCode: string; open: boolean }): Promise<void>;
    startDiscovery(): Promise<LanRoom[]>;
    stopDiscovery(): Promise<void>;
    onRoomsChanged(listener: (rooms: LanRoom[]) => void): () => void;
  };
}

interface Window {
  ancientBeastDesktop?: AncientBeastDesktopApi;
}
