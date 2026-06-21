#!/usr/bin/env python3
"""
Overflow — Bradley-Terry Reward Model Training

Trains a reward model from human preference rankings over counterfactual
driving trajectories. The reward model learns to score trajectories such
that human-preferred trajectories receive higher scores.

Loss: L = -log(σ(r(x_w) - r(x_l))) for each preference pair (x_w, x_l)

Usage:
  python scripts/train_reward_model.py \
    --preferences data/rankings.json \
    --scenes data/scene_embeddings.pt \
    --epochs 50 \
    --batch-size 64
"""

import os
import json
import argparse
import logging

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("overflow.reward_model")

# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------

class SceneEncoder(nn.Module):
    """Encodes driving scene context (LiDAR features + agent states)."""

    def __init__(self, lidar_dim: int = 512, agent_dim: int = 128, hidden: int = 256):
        super().__init__()
        self.lidar_proj = nn.Sequential(
            nn.Linear(lidar_dim, hidden),
            nn.LayerNorm(hidden),
            nn.GELU(),
        )
        self.agent_proj = nn.Sequential(
            nn.Linear(agent_dim, hidden),
            nn.LayerNorm(hidden),
            nn.GELU(),
        )
        self.fuse = nn.Sequential(
            nn.Linear(hidden * 2, hidden),
            nn.GELU(),
        )

    def forward(self, lidar_feat: torch.Tensor, agent_feat: torch.Tensor) -> torch.Tensor:
        l = self.lidar_proj(lidar_feat)
        a = self.agent_proj(agent_feat)
        return self.fuse(torch.cat([l, a], dim=-1))


class TrajectoryEncoder(nn.Module):
    """Encodes a trajectory (sequence of waypoints) into a fixed-size vector."""

    def __init__(self, waypoint_dim: int = 5, hidden: int = 128, n_layers: int = 2):
        super().__init__()
        self.input_proj = nn.Linear(waypoint_dim, hidden)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=hidden, nhead=4, dim_feedforward=hidden * 2,
            dropout=0.1, activation="gelu", batch_first=True,
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=n_layers)
        self.pool = nn.AdaptiveAvgPool1d(1)

    def forward(self, waypoints: torch.Tensor) -> torch.Tensor:
        # waypoints: (B, T, 5) — [x, y, yaw, speed, dt]
        h = self.input_proj(waypoints)
        h = self.transformer(h)
        h = h.permute(0, 2, 1)   # (B, hidden, T)
        h = self.pool(h).squeeze(-1)  # (B, hidden)
        return h


class RewardModel(nn.Module):
    """
    Bradley-Terry reward model.
    Takes (scene, trajectory) → scalar reward.
    Trained so preferred trajectories score higher.
    """

    def __init__(self, scene_dim: int = 256, traj_dim: int = 128):
        super().__init__()
        self.scene_encoder = SceneEncoder(hidden=scene_dim)
        self.traj_encoder = TrajectoryEncoder(hidden=traj_dim)
        self.head = nn.Sequential(
            nn.Linear(scene_dim + traj_dim, 256),
            nn.GELU(),
            nn.Dropout(0.1),
            nn.Linear(256, 128),
            nn.GELU(),
            nn.Linear(128, 1),
        )

    def forward(
        self,
        lidar_feat: torch.Tensor,
        agent_feat: torch.Tensor,
        waypoints: torch.Tensor,
    ) -> torch.Tensor:
        scene = self.scene_encoder(lidar_feat, agent_feat)
        traj = self.traj_encoder(waypoints)
        combined = torch.cat([scene, traj], dim=-1)
        return self.head(combined).squeeze(-1)


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------

class PreferenceDataset(Dataset):
    """
    Each item is a preference pair: (scene, traj_win, traj_lose).
    The reward model should assign r(traj_win) > r(traj_lose).
    """

    def __init__(self, preferences_path: str, scenes_path: str):
        with open(preferences_path) as f:
            self.preferences = json.load(f)

        self.scenes = torch.load(scenes_path, weights_only=True)
        logger.info(f"Loaded {len(self.preferences)} preference pairs")

    def __len__(self):
        return len(self.preferences)

    def __getitem__(self, idx):
        pref = self.preferences[idx]
        scene_id = pref["scene_id"]

        scene_data = self.scenes[scene_id]
        lidar_feat = scene_data["lidar_features"]
        agent_feat = scene_data["agent_features"]

        traj_win = torch.tensor(pref["trajectory_win"], dtype=torch.float32)
        traj_lose = torch.tensor(pref["trajectory_lose"], dtype=torch.float32)

        return lidar_feat, agent_feat, traj_win, traj_lose


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def bradley_terry_loss(r_win: torch.Tensor, r_lose: torch.Tensor) -> torch.Tensor:
    """L = -log(σ(r_win - r_lose))"""
    return -torch.log(torch.sigmoid(r_win - r_lose) + 1e-8).mean()


def compute_accuracy(r_win: torch.Tensor, r_lose: torch.Tensor) -> float:
    """Fraction of pairs where reward model agrees with human preference."""
    return (r_win > r_lose).float().mean().item()


def train(
    model: RewardModel,
    dataloader: DataLoader,
    optimizer: optim.Optimizer,
    scheduler: optim.lr_scheduler.LRScheduler,
    epochs: int,
    device: torch.device,
    checkpoint_dir: str = "checkpoints",
):
    os.makedirs(checkpoint_dir, exist_ok=True)
    model.to(device)
    best_acc = 0.0

    for epoch in range(epochs):
        model.train()
        total_loss = 0.0
        total_acc = 0.0
        n_batches = 0

        for lidar, agents, traj_w, traj_l in dataloader:
            lidar = lidar.to(device)
            agents = agents.to(device)
            traj_w = traj_w.to(device)
            traj_l = traj_l.to(device)

            r_win = model(lidar, agents, traj_w)
            r_lose = model(lidar, agents, traj_l)

            loss = bradley_terry_loss(r_win, r_lose)

            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()

            total_loss += loss.item()
            total_acc += compute_accuracy(r_win, r_lose)
            n_batches += 1

        avg_loss = total_loss / n_batches
        avg_acc = total_acc / n_batches
        lr = scheduler.get_last_lr()[0]
        scheduler.step()

        is_best = avg_acc > best_acc
        if is_best:
            best_acc = avg_acc
            torch.save(model.state_dict(), os.path.join(checkpoint_dir, "reward_model_best.pt"))

        logger.info(
            f"[epoch {epoch+1:>3}/{epochs}]  "
            f"loss={avg_loss:.4f}  acc={avg_acc:.1%}  "
            f"lr={lr:.2e}  best={best_acc:.1%}"
            f"{'  ★' if is_best else ''}"
        )

    # Save final
    torch.save(model.state_dict(), os.path.join(checkpoint_dir, "reward_model_final.pt"))
    logger.info(f"Training complete. Best accuracy: {best_acc:.1%}")
    logger.info(f"Model saved to {checkpoint_dir}/reward_model_final.pt")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Overflow reward model training")
    parser.add_argument("--preferences", type=str, required=True, help="Path to preference pairs JSON")
    parser.add_argument("--scenes", type=str, required=True, help="Path to scene embeddings .pt")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--checkpoint-dir", type=str, default="checkpoints")
    parser.add_argument("--device", type=str, default="cuda" if torch.cuda.is_available() else "cpu")
    args = parser.parse_args()

    logger.info("Overflow — Bradley-Terry Reward Model Training")
    logger.info(f"Device: {args.device}")

    dataset = PreferenceDataset(args.preferences, args.scenes)
    dataloader = DataLoader(dataset, batch_size=args.batch_size, shuffle=True, num_workers=4, pin_memory=True)

    model = RewardModel()
    logger.info(f"Model parameters: {sum(p.numel() for p in model.parameters()):,}")

    optimizer = optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)

    train(model, dataloader, optimizer, scheduler, args.epochs, torch.device(args.device), args.checkpoint_dir)


if __name__ == "__main__":
    main()
