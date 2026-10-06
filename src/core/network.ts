import { Networks } from "@stellar/stellar-base";

export type NetworkConfig = {
  network: "TESTNET" | "PUBLIC";
  networkName: string;
  networkPassphrase: string;
  networkUrl: string;
  sorobanRpcUrl: string;
  friendbotUrl?: string;
  explorerUrl: string;
};

export const TESTNET: NetworkConfig = {
  network: "TESTNET",
  networkName: "Test Net",
  networkPassphrase: Networks.TESTNET,
  networkUrl: "https://horizon-testnet.stellar.org",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  friendbotUrl: "https://friendbot.stellar.org",
  explorerUrl: "https://stellar.expert/explorer/testnet",
};

export const PUBLIC: NetworkConfig = {
  network: "PUBLIC",
  networkName: "Main Net",
  networkPassphrase: Networks.PUBLIC,
  networkUrl: "https://horizon.stellar.org",
  sorobanRpcUrl: "https://mainnet.sorobanrpc.com",
  explorerUrl: "https://stellar.expert/explorer/public",
};
