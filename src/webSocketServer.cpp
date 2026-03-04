#include "WebSocketServer.hpp"

#include <boost/beast/http.hpp>
#include <iostream>

FrameBroadcaster::FrameBroadcaster(boost::asio::io_context& ioc, unsigned short port)
    : ioc_(ioc), acceptor_(ioc) {
    boost::beast::error_code ec;

    const auto openEndpoint = [&](tcp::endpoint ep) {
        acceptor_.open(ep.protocol(), ec);
        if (ec) {
            std::cerr << "WebSocket acceptor open error: " << ec.message() << "\n";
            return false;
        }

        acceptor_.set_option(boost::asio::socket_base::reuse_address(true), ec);
        if (ec) {
            std::cerr << "WebSocket set_option reuse_address error: " << ec.message() << "\n";
            return false;
        }

        if (ep.protocol() == tcp::v6()) {
            // Allow dual-stack (IPv4-mapped) so ws://localhost works whether it resolves to 127.0.0.1 or ::1
            acceptor_.set_option(boost::asio::ip::v6_only(false), ec);
            if (ec) {
                std::cerr << "WebSocket set_option v6_only error: " << ec.message() << "\n";
            }
        }

        acceptor_.bind(ep, ec);
        if (ec) {
            std::cerr << "WebSocket bind error: " << ec.message() << "\n";
            return false;
        }

        acceptor_.listen(boost::asio::socket_base::max_listen_connections, ec);
        if (ec) {
            std::cerr << "WebSocket listen error: " << ec.message() << "\n";
            return false;
        }
        return true;
    };

    // Prefer IPv4 (most dev browsers connect via 127.0.0.1). If it fails (already bound or disabled), try dual-stack IPv6.
    if (!openEndpoint(tcp::endpoint(tcp::v4(), port))) {
        acceptor_.close();
        ec.clear();
        std::cerr << "Retrying dual-stack IPv6 bind for WebSocket on port " << port << "...\n";
        if (!openEndpoint(tcp::endpoint(tcp::v6(), port))) {
            std::cerr << "WebSocket listener failed to start; frames will not stream.\n";
            return;
        }
    }

    std::cout << "WebSocket server listening on port " << port << "\n";

    doAccept();
}

void FrameBroadcaster::stop() {
    boost::beast::error_code ec;
    acceptor_.close(ec);
}

void FrameBroadcaster::broadcast(const std::shared_ptr<std::vector<uint8_t>>& payload) {
    std::lock_guard<std::mutex> lock(sessionsMutex_);
    std::vector<std::shared_ptr<Session>> stillAlive;
    stillAlive.reserve(sessions_.size());

    for (auto& session : sessions_) {
        if (session->isOpen()) {
            session->send(payload);
            stillAlive.push_back(session);
        }
    }
    sessions_.swap(stillAlive);
}

void FrameBroadcaster::registerSession(const std::shared_ptr<Session>& session) {
    std::lock_guard<std::mutex> lock(sessionsMutex_);
    sessions_.push_back(session);
}

void FrameBroadcaster::doAccept() {
    acceptor_.async_accept(
        boost::asio::make_strand(ioc_),
        [this](boost::beast::error_code ec, tcp::socket socket) {
            if (!ec) {
                auto session = std::make_shared<Session>(std::move(socket), *this);
                session->run();
            } else if (ec != boost::asio::error::operation_aborted) {
                std::cerr << "WebSocket accept error: " << ec.message() << "\n";
            }
            doAccept();
        });
}

FrameBroadcaster::Session::Session(tcp::socket socket, FrameBroadcaster& owner)
    : ws_(std::move(socket)), owner_(owner) {}

bool FrameBroadcaster::Session::isOpen() const {
    return ws_.is_open();
}

void FrameBroadcaster::Session::run() {
    ws_.set_option(boost::beast::websocket::stream_base::timeout::suggested(
        boost::beast::role_type::server));
    ws_.set_option(boost::beast::websocket::stream_base::decorator(
        [](boost::beast::websocket::response_type& res) {
            res.set(boost::beast::http::field::server, std::string("nbody-ws"));
        }));

    // Ensure frames are sent as binary; the payload is raw FlatBuffer bytes.
    ws_.binary(true);

    ws_.async_accept(
        [self = shared_from_this()](boost::beast::error_code ec) { self->onAccept(ec); });
}

void FrameBroadcaster::Session::onAccept(boost::beast::error_code ec) {
    if (ec) {
        std::cerr << "WebSocket accept handshake failed: " << ec.message() << "\n";
        return;
    }
    std::cout << "WebSocket client connected\n";
    owner_.registerSession(shared_from_this());
}

void FrameBroadcaster::Session::send(const std::shared_ptr<std::vector<uint8_t>>& payload) {
    boost::asio::dispatch(ws_.get_executor(), [self = shared_from_this(), payload]() {
        const bool writing = !self->queue_.empty();
        self->queue_.push_back(payload);
        if (!writing) self->doWrite();
    });
}

void FrameBroadcaster::Session::doWrite() {
    const auto msg = queue_.front();
    ws_.async_write(
        boost::asio::buffer(*msg),
        [self = shared_from_this()](boost::beast::error_code ec, std::size_t) {
            if (ec) {
                std::cerr << "WebSocket write error: " << ec.message() << "\n";
                self->queue_.clear();
                return;
            }
            self->queue_.pop_front();
            if (!self->queue_.empty()) self->doWrite();
        });
}
