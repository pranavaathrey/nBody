#pragma once

#include <boost/asio.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>
#include <deque>
#include <memory>
#include <mutex>
#include <vector>

class FrameBroadcaster {
    public:
    FrameBroadcaster(boost::asio::io_context& ioc, unsigned short port);
    void broadcast(const std::shared_ptr<std::vector<uint8_t>>& payload);
    void stop();

    private:
    using tcp = boost::asio::ip::tcp;
    using websocket = boost::beast::websocket::stream<tcp::socket>;

    struct Session : public std::enable_shared_from_this<Session> {
        explicit Session(tcp::socket socket, FrameBroadcaster& owner);
        void run();
        void send(const std::shared_ptr<std::vector<uint8_t>>& payload);
        bool isOpen() const;

        private:
        void onAccept(boost::beast::error_code ec);
        void doWrite();

        websocket ws_;
        FrameBroadcaster& owner_;
        std::deque<std::shared_ptr<std::vector<uint8_t>>> queue_;
    };

    void registerSession(const std::shared_ptr<Session>& session);

    void doAccept();

    boost::asio::io_context& ioc_;
    tcp::acceptor acceptor_;
    std::mutex sessionsMutex_;
    std::vector<std::shared_ptr<Session>> sessions_;
};
