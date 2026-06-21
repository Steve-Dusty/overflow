#!/usr/bin/env python3
"""
Overflow — GRPO (Group Relative Policy Optimization)

Optimizes the driving policy using the trained reward model.
For each scene, generates K trajectory candidates from the policy,
scores them with the reward model, computes group-relative advantages,
and updates the policy toward higher-reward trajectories.

Key difference from PPO: no value baseline needed. Advantages are computed
relative to the group mean, making it simpler and more sample-efficient.

Usage:
  python scripts/train_grpo.py \
    --reward-model checkpoints/reward_model_best.pt \
    --base-policy checkpoints/policy_base.pt \
    --scenes data/scene_embeddings.pt \
    --epochs 30 \
    --k-candidates 8
"""

import os
import json
import argparse
import logging
from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F
import torch.optim as optim
from torch.distributions import Categorical

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("overflow.grpo")


# ---------------------------------------------------------------------------
# Trajectory Policy Model
# ---------------------------------------------------------------------------

class TrajectoryPolicyModel(nn.Module):
    """
    Generates candidate trajectories and outputs action logits.
    Architecture: scene encoder → transformer decoder → waypoint predictor.
    """

    def __init__(
        self,
        scene_dim: int = 256,
        hidden_dim: int = 256,
        n_layers: int = 12,
        n_heads: int = 8,
        n_actions: int = 9,
        max_waypoints: int = 30,
        waypoint_dim: int = 5,
    ):
        super().__init__()
        self.hidden_dim = hidden_dim
        self.max_waypoints = max_waypoints

        # Scene context encoder
        self.scene_proj = nn.Sequential(
            nn.Linear(scene_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.GELU(),
        )

        # Learnable trajectory queries (one per waypoint)
        self.traj_queries = nn.Parameter(torch.randn(max_waypoints, hidden_dim) * 0.02)

        # Transformer decoder: queries attend to scene context
        decoder_layer = nn.TransformerDecoderLayer(
            d_model=hidden_dim,
            nhead=n_heads,
            dim_feedforward=hidden_dim * 4,
            dropout=0.1,
            activation="gelu",
            batch_first=True,
        )
        self.decoder = nn.TransformerDecoder(decoder_layer, num_layers=n_layers)

        # Waypoint prediction head: outputs (x, y, yaw, speed, dt) per step
        self.waypoint_head = nn.Linear(hidden_dim, waypoint_dim)

        # Action classification head (for discrete action output)
        self.action_head = nn.Sequential(
            nn.AdaptiveAvgPool1d(1),
            nn.Flatten(),
            nn.Linear(hidden_dim, n_actions),
        )

    def forward(self, scene_embed: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """
        Args:
            scene_embed: (B, scene_dim) scene context vector

        Returns:
            waypoints: (B, T, 5) predicted trajectory waypoints
            action_logits: (B, 9) discrete action logits
        """
        B = scene_embed.shape[0]

        # Project scene context
        context = self.scene_proj(scene_embed).unsqueeze(1)  # (B, 1, H)

        # Expand trajectory queries for the batch
        queries = self.traj_queries.unsqueeze(0).expand(B, -1, -1)  # (B, T, H)

        # Decode: trajectory queries attend to scene context
        decoded = self.decoder(queries, context)  # (B, T, H)

        # Predict waypoints
        waypoints = self.waypoint_head(decoded)  # (B, T, 5)

        # Predict discrete action
        action_logits = self.action_head(decoded.permute(0, 2, 1))  # (B, 9)

        return waypoints, action_logits

    def sample_trajectories(
        self,
        scene_embed: torch.Tensor,
        k: int = 8,
        temperature: float = 1.0,
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Sample K diverse trajectory candidates for each scene.

        Returns:
            waypoints: (B, K, T, 5)
            actions: (B, K) sampled action indices
            log_probs: (B, K) log probabilities of sampled actions
        """
        B = scene_embed.shape[0]

        all_waypoints = []
        all_actions = []
        all_log_probs = []

        for _ in range(k):
            # Add noise to scene embedding for diversity
            noise = torch.randn_like(scene_embed) * 0.1 * temperature
            noisy_embed = scene_embed + noise

            waypoints, action_logits = self.forward(noisy_embed)
            dist = Categorical(logits=action_logits / temperature)
            action = dist.sample()
            log_prob = dist.log_prob(action)

            all_waypoints.append(waypoints)
            all_actions.append(action)
            all_log_probs.append(log_prob)

        return (
            torch.stack(all_waypoints, dim=1),  # (B, K, T, 5)
            torch.stack(all_actions, dim=1),     # (B, K)
            torch.stack(all_log_probs, dim=1),   # (B, K)
        )


# ---------------------------------------------------------------------------
# GRPO Trainer
# ---------------------------------------------------------------------------

@dataclass
class GRPOConfig:
    k_candidates: int = 8
    kl_coeff: float = 0.01
    kl_budget: float = 0.05
    clip_ratio: float = 0.2
    temperature: float = 1.0
    lr: float = 3e-5
    weight_decay: float = 0.01
    max_grad_norm: float = 1.0
    epochs: int = 30
    batch_size: int = 16


class GRPOTrainer:
    """
    Group Relative Policy Optimization.

    Core algorithm:
      1. Generate K trajectories per scene from the policy
      2. Score each with the reward model
      3. Compute group-relative advantages: A_i = (r_i - μ_group) / σ_group
      4. Policy gradient: L = -Σ A_i · log π(a_i | s)
      5. KL penalty: L_kl = β · KL(π || π_ref)
    """

    def __init__(
        self,
        policy: TrajectoryPolicyModel,
        reward_model: nn.Module,
        config: GRPOConfig,
        device: torch.device,
    ):
        self.policy = policy.to(device)
        self.reward_model = reward_model.to(device).eval()
        self.config = config
        self.device = device

        # Freeze reward model
        for p in self.reward_model.parameters():
            p.requires_grad_(False)

        # Reference policy (frozen copy for KL constraint)
        self.ref_policy = TrajectoryPolicyModel().to(device)
        self.ref_policy.load_state_dict(policy.state_dict())
        self.ref_policy.eval()
        for p in self.ref_policy.parameters():
            p.requires_grad_(False)

        self.optimizer = optim.AdamW(
            self.policy.parameters(),
            lr=config.lr,
            weight_decay=config.weight_decay,
        )
        self.scheduler = optim.lr_scheduler.CosineAnnealingLR(
            self.optimizer, T_max=config.epochs,
        )

    def compute_group_advantages(self, rewards: torch.Tensor) -> torch.Tensor:
        """
        Compute group-relative advantages.
        rewards: (B, K) reward scores for K candidates per scene
        returns: (B, K) normalized advantages
        """
        mean = rewards.mean(dim=1, keepdim=True)
        std = rewards.std(dim=1, keepdim=True).clamp(min=1e-8)
        return (rewards - mean) / std

    def compute_kl_divergence(
        self,
        scene_embed: torch.Tensor,
        actions: torch.Tensor,
    ) -> torch.Tensor:
        """Approximate KL(π || π_ref) using sampled actions."""
        with torch.no_grad():
            _, ref_logits = self.ref_policy(scene_embed)
            ref_dist = Categorical(logits=ref_logits)
            ref_log_probs = ref_dist.log_prob(actions[:, 0])  # first candidate

        _, cur_logits = self.policy(scene_embed)
        cur_dist = Categorical(logits=cur_logits)
        cur_log_probs = cur_dist.log_prob(actions[:, 0])

        return (cur_log_probs - ref_log_probs).mean()

    def train_step(self, scene_embeds: torch.Tensor) -> dict:
        """
        One GRPO update step.

        1. Sample K candidates from policy
        2. Score with reward model
        3. Compute group-relative advantages
        4. Policy gradient + KL penalty
        """
        self.policy.train()
        scene_embeds = scene_embeds.to(self.device)
        B = scene_embeds.shape[0]
        K = self.config.k_candidates

        # 1. Sample K trajectory candidates
        waypoints, actions, log_probs = self.policy.sample_trajectories(
            scene_embeds, k=K, temperature=self.config.temperature,
        )

        # 2. Score each candidate with reward model
        rewards = torch.zeros(B, K, device=self.device)
        with torch.no_grad():
            for k_idx in range(K):
                # Reward model expects (scene_feat, agent_feat, trajectory)
                # We pass scene_embed as both for simplicity
                rewards[:, k_idx] = self.reward_model(
                    scene_embeds, scene_embeds[:, :128], waypoints[:, k_idx],
                )

        # 3. Group-relative advantages
        advantages = self.compute_group_advantages(rewards)  # (B, K)

        # 4. Policy gradient loss
        # L = -Σ_k advantage_k * log_prob_k
        pg_loss = -(advantages.detach() * log_probs).mean()

        # 5. KL penalty
        kl = self.compute_kl_divergence(scene_embeds, actions)
        kl_loss = self.config.kl_coeff * kl

        # Total loss
        total_loss = pg_loss + kl_loss

        # Backward
        self.optimizer.zero_grad()
        total_loss.backward()
        torch.nn.utils.clip_grad_norm_(
            self.policy.parameters(), self.config.max_grad_norm,
        )
        self.optimizer.step()

        return {
            "loss": total_loss.item(),
            "pg_loss": pg_loss.item(),
            "kl": kl.item(),
            "avg_reward": rewards.mean().item(),
            "best_reward": rewards.max(dim=1).values.mean().item(),
            "advantage_std": advantages.std().item(),
        }

    def train(self, scene_dataset: torch.Tensor):
        """Full GRPO training loop."""
        logger.info("=" * 70)
        logger.info("  Overflow — GRPO Policy Optimization")
        logger.info("=" * 70)
        logger.info(f"  Policy params:     {sum(p.numel() for p in self.policy.parameters()):,}")
        logger.info(f"  K candidates:      {self.config.k_candidates}")
        logger.info(f"  KL budget:         {self.config.kl_budget}")
        logger.info(f"  Epochs:            {self.config.epochs}")

        n_scenes = scene_dataset.shape[0]
        best_reward = -float("inf")

        for epoch in range(self.config.epochs):
            # Shuffle scenes
            perm = torch.randperm(n_scenes)
            epoch_metrics = {"loss": 0, "pg_loss": 0, "kl": 0, "avg_reward": 0, "best_reward": 0}
            n_batches = 0

            for i in range(0, n_scenes, self.config.batch_size):
                batch_idx = perm[i : i + self.config.batch_size]
                batch = scene_dataset[batch_idx]

                metrics = self.train_step(batch)
                for k in epoch_metrics:
                    epoch_metrics[k] += metrics.get(k, 0)
                n_batches += 1

            # Average metrics
            for k in epoch_metrics:
                epoch_metrics[k] /= max(n_batches, 1)

            self.scheduler.step()
            lr = self.scheduler.get_last_lr()[0]

            is_best = epoch_metrics["avg_reward"] > best_reward
            if is_best:
                best_reward = epoch_metrics["avg_reward"]
                torch.save(
                    self.policy.state_dict(),
                    os.path.join("checkpoints", "policy_grpo_best.pt"),
                )

            # KL budget check
            kl_status = "OK" if epoch_metrics["kl"] < self.config.kl_budget else "EXCEEDED"

            logger.info(
                f"[epoch {epoch+1:>2}/{self.config.epochs}]  "
                f"R={epoch_metrics['avg_reward']:>+.4f}  "
                f"best_R={epoch_metrics['best_reward']:>+.4f}  "
                f"loss={epoch_metrics['loss']:.4f}  "
                f"KL={epoch_metrics['kl']:.4f} ({kl_status})  "
                f"lr={lr:.2e}"
                f"{'  ★' if is_best else ''}"
            )

            # Adaptive KL coefficient
            if epoch_metrics["kl"] > self.config.kl_budget * 1.5:
                self.config.kl_coeff *= 2.0
                logger.warning(f"KL exceeded budget — increasing kl_coeff to {self.config.kl_coeff:.4f}")
            elif epoch_metrics["kl"] < self.config.kl_budget * 0.5:
                self.config.kl_coeff = max(0.001, self.config.kl_coeff * 0.5)

        # Save final
        torch.save(self.policy.state_dict(), os.path.join("checkpoints", "policy_grpo_final.pt"))
        logger.info(f"GRPO complete. Best reward: {best_reward:+.4f}")
        logger.info(f"Policy saved to checkpoints/policy_grpo_final.pt")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Overflow GRPO training")
    parser.add_argument("--reward-model", type=str, required=True)
    parser.add_argument("--base-policy", type=str, default=None)
    parser.add_argument("--scenes", type=str, required=True)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--k-candidates", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=3e-5)
    parser.add_argument("--kl-budget", type=float, default=0.05)
    parser.add_argument("--device", type=str, default="cuda" if torch.cuda.is_available() else "cpu")
    args = parser.parse_args()

    device = torch.device(args.device)
    os.makedirs("checkpoints", exist_ok=True)

    # Load reward model
    from train_reward_model import RewardModel
    reward_model = RewardModel()
    reward_model.load_state_dict(torch.load(args.reward_model, map_location=device, weights_only=True))
    logger.info("Loaded reward model")

    # Initialize policy
    policy = TrajectoryPolicyModel()
    if args.base_policy:
        policy.load_state_dict(torch.load(args.base_policy, map_location=device, weights_only=True))
        logger.info("Loaded base policy weights")
    logger.info(f"Policy parameters: {sum(p.numel() for p in policy.parameters()):,}")

    # Load scene embeddings
    scene_data = torch.load(args.scenes, map_location=device, weights_only=True)
    logger.info(f"Loaded {scene_data.shape[0]} scene embeddings")

    # Train
    config = GRPOConfig(
        k_candidates=args.k_candidates,
        kl_budget=args.kl_budget,
        lr=args.lr,
        epochs=args.epochs,
        batch_size=args.batch_size,
    )
    trainer = GRPOTrainer(policy, reward_model, config, device)
    trainer.train(scene_data)


if __name__ == "__main__":
    main()
