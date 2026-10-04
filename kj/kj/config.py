import os
from dataclasses import dataclass
from pathlib import Path


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class Config:
    username: str
    password: str
    profile_dir: Path
    code_file: Path
    state_file: Path


def load_config(env: dict[str, str] | None = None) -> Config:
    env = env if env is not None else dict(os.environ)
    username, password = env.get("KJ_USER"), env.get("KJ_PWD")
    if not username or not password:
        raise ConfigError("KJ_USER and KJ_PWD must be set")
    data_dir = Path(env.get("KJ_DATA_DIR", "/data"))
    return Config(username, password, data_dir / "profile", data_dir / "code.txt", data_dir / "state.json")
