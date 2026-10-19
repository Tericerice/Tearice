"""Own the loopback socket used by the desktop server."""

from __future__ import annotations

import errno
import socket
import sys
from dataclasses import dataclass
from typing import Final, Protocol

LOOPBACK_HOST: Final = "127.0.0.1"


class _Ipv4AddressReader(Protocol):
    def getsockname(self) -> tuple[str, int]:
        """Return an IPv4 host and port pair."""
        ...


@dataclass(frozen=True, slots=True)
class LoopbackBinding:
    """A bound socket and the requested-to-actual port decision."""

    requested_port: int
    actual_port: int
    listener: socket.socket

    @property
    def fell_back(self) -> bool:
        """Return whether the requested port was already occupied."""
        return self.actual_port != self.requested_port


def bind_loopback_socket(requested_port: int) -> LoopbackBinding:
    """Bind the requested port, falling back only when it is occupied."""
    try:
        listener = _bind_port(requested_port)
    except OSError as error:
        if error.errno != errno.EADDRINUSE:
            raise
        listener = _bind_port(0)

    actual_port = _bound_port(listener)
    return LoopbackBinding(
        requested_port=requested_port,
        actual_port=actual_port,
        listener=listener,
    )


def _bind_port(port: int) -> socket.socket:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        if sys.platform == "win32":
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        listener.bind((LOOPBACK_HOST, port))
        listener.set_inheritable(True)
    except OSError:
        listener.close()
        raise
    return listener


def _bound_port(listener: _Ipv4AddressReader) -> int:
    return listener.getsockname()[1]
