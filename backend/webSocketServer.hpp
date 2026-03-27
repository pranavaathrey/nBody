#pragma once

#include <boost/asio.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

class FrameBroadcaster {
    public:
    using TextMessageHandler = std::function<void(const std::string&)>;
    using InitialTextMessageProvider = std::function<std::string()>;

    FrameBroadcaster(
        boost::asio::io_context& ioc,
        unsigned short port,
        TextMessageHandler onTextMessage = {},
        InitialTextMessageProvider initialTextMessageProvider = {});

    void broadcast(const std::shared_ptr<std::vector<uint8_t>>& payload);
    void broadcastText(const std::string& message);
    void stop();

    private:
    using tcp = boost::asio::ip::tcp;
    using websocket = boost::beast::websocket::stream<tcp::socket>;

    struct OutboundMessage {
        bool binary = false;
        std::shared_ptr<std::vector<uint8_t>> binaryPayload;
        std::shared_ptr<std::string> textPayload;
    };

    struct Session : public std::enable_shared_from_this<Session> {
        explicit Session(tcp::socket socket, FrameBroadcaster& owner);
        void run();
        void sendBinary(const std::shared_ptr<std::vector<uint8_t>>& payload);
        void sendText(const std::shared_ptr<std::string>& payload);
        bool isOpen() const;

        private:
        void onAccept(boost::beast::error_code ec);
        void doRead();
        void onRead(boost::beast::error_code ec, std::size_t bytesTransferred);
        void doWrite();
        void onWrite(boost::beast::error_code ec, std::size_t bytesTransferred);

        websocket ws_;
        FrameBroadcaster& owner_;
        boost::beast::flat_buffer readBuffer_;
        std::deque<OutboundMessage> queue_;
    };

    void registerSession(const std::shared_ptr<Session>& session);
    void handleTextMessage(const std::string& payload);
    std::string makeInitialTextMessage() const;

    void doAccept();

    boost::asio::io_context& ioc_;
    tcp::acceptor acceptor_;
    TextMessageHandler onTextMessage_;
    InitialTextMessageProvider initialTextMessageProvider_;
    std::mutex sessionsMutex_;
    std::vector<std::shared_ptr<Session>> sessions_;
};
