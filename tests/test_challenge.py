import pytest

from backend.yuanta_api import YuantaAPIError, YuantaClient, challenge_redirect

HOST = "https://ysradar.yuanta.com.vn"
CHALLENGE = ('<html><head><title>Attention Required</title></head><body><script>window.location.href='
             f'"{HOST}/api/v3/market_data/price_board/index/list_index?jskey=B0C9rGJdyLmkSISF5PDt3AZVjC%2B"'
             "</script></body></html>")


class Resp:
    def __init__(self, text="", status=200, url="u", payload=None):
        self.text, self.status_code, self.url, self.reason, self.headers = text, status, url, "OK", {"content-type": "x"}
        self._p = payload

    def json(self):
        if self._p is None:
            raise ValueError("no json")
        return self._p


class Sess:
    def __init__(self, responses):
        self.responses, self.urls = list(responses), []

    def get(self, url, params=None, timeout=None):
        self.urls.append(url)
        return self.responses.pop(0)


def test_parse_challenge():
    assert challenge_redirect(CHALLENGE).endswith("?jskey=B0C9rGJdyLmkSISF5PDt3AZVjC%2B")
    assert challenge_redirect('{"success": true}') is None


def test_challenge_must_stay_on_yuanta_host():
    evil = CHALLENGE.replace("ysradar.yuanta.com.vn", "evil.example.com")
    assert challenge_redirect(evil) is None


def test_client_follows_challenge_then_gets_json():
    ok = {"success": True, "response": [{"IndexCode": "VNINDEX", "IndexName": "VN-INDEX", "OrderID": 1}]}
    s = Sess([Resp(CHALLENGE), Resp(payload=ok, text='{"success":true}')])
    assert YuantaClient(session=s).list_indexes()[0]["code"] == "VNINDEX"
    assert len(s.urls) == 2 and "jskey=" in s.urls[1]


def test_client_gives_up_after_max_hops():
    s = Sess([Resp(CHALLENGE)] * 6)
    with pytest.raises(YuantaAPIError, match="non-JSON"):
        YuantaClient(session=s).list_indexes()
    assert len(s.urls) == 4  # 1 request + 3 hops
