window.VN_BOSS_LITE_TEMPLATES = {
  cleaning: {
    name: '매장 청소 점검',
    deadlineDefault: true,
    tones: {
      soft: {
        ko: '영업 시작 전과 마감 후 매장 청소 상태를 확인해 주세요. 부족한 부분이 있으면 서로 협조하여 정리하고 확인해 주시면 감사하겠습니다.',
        vi: 'Vui lòng kiểm tra tình trạng vệ sinh cửa hàng trước khi bắt đầu kinh doanh và sau khi đóng cửa. Nếu có điểm nào chưa sạch, mong mọi người hỗ trợ nhau xử lý và xác nhận lại.'
      },
      normal: {
        ko: '영업 시작 전과 마감 후 매장 청소 상태를 점검해 주세요.',
        vi: 'Vui lòng kiểm tra tình trạng vệ sinh cửa hàng trước khi bắt đầu kinh doanh và sau khi đóng cửa.'
      },
      strong: {
        ko: '영업 시작 전과 마감 후 매장 청소 상태를 반드시 점검해 주세요. 청소 미흡 사항이 발생하지 않도록 꼼꼼히 확인 바랍니다.',
        vi: 'Bắt buộc kiểm tra tình trạng vệ sinh cửa hàng trước khi bắt đầu kinh doanh và sau khi đóng cửa. Vui lòng kiểm tra kỹ để không xảy ra thiếu sót.'
      }
    }
  },
  inventory: {
    name: '재고 확인 요청',
    deadlineDefault: true,
    tones: {
      soft: {
        ko: '현재 재고 수량을 확인하고 부족한 품목을 정리해 주세요. 확인 후 공유해 주시면 운영에 도움이 됩니다.',
        vi: 'Vui lòng kiểm tra số lượng hàng tồn hiện tại và tổng hợp các mặt hàng còn thiếu. Sau khi kiểm tra, mong bạn chia sẻ lại để hỗ trợ việc vận hành.'
      },
      normal: {
        ko: '현재 재고 수량을 확인하고 부족한 품목을 정리하여 보고해 주세요.',
        vi: 'Vui lòng kiểm tra số lượng hàng tồn hiện tại và tổng hợp các mặt hàng còn thiếu để báo cáo.'
      },
      strong: {
        ko: '현재 재고 수량을 정확히 확인하고 부족한 품목을 빠짐없이 정리하여 보고해 주세요. 누락이 없도록 다시 확인 바랍니다.',
        vi: 'Vui lòng kiểm tra chính xác số lượng hàng tồn hiện tại và tổng hợp đầy đủ các mặt hàng còn thiếu để báo cáo. Cần kiểm tra lại để tránh bỏ sót.'
      }
    }
  },
  attendance: {
    name: '지각 및 출근 시간 안내',
    deadlineDefault: false,
    tones: {
      soft: {
        ko: '원활한 근무 준비를 위해 출근 시간을 잘 지켜 주세요. 부득이하게 늦을 경우에는 미리 연락 부탁드립니다.',
        vi: 'Để việc chuẩn bị công việc diễn ra thuận lợi, mong mọi người tuân thủ giờ vào làm. Nếu có việc phát sinh khiến bạn đến muộn, vui lòng báo trước.'
      },
      normal: {
        ko: '출근 시간을 준수해 주시기 바랍니다. 지각 시 반드시 사전에 연락 바랍니다.',
        vi: 'Vui lòng tuân thủ giờ vào làm. Nếu đi muộn, bắt buộc phải thông báo trước.'
      },
      strong: {
        ko: '출근 시간은 반드시 준수해 주세요. 지각이 예상되는 경우 사전 연락은 필수이며 반복적인 지각이 발생하지 않도록 주의 바랍니다.',
        vi: 'Bắt buộc tuân thủ giờ vào làm. Nếu dự kiến đi muộn, phải thông báo trước và cần chú ý để không tái diễn tình trạng đi trễ.'
      }
    }
  },
  sales: {
    name: '매출 보고 요청',
    deadlineDefault: true,
    tones: {
      soft: { ko: '금일 매출 현황을 정리하여 공유해 주세요. 확인 후 운영 방향을 함께 조정하겠습니다.', vi: 'Vui lòng tổng hợp và chia sẻ tình hình doanh thu hôm nay. Sau khi kiểm tra, chúng ta sẽ cùng điều chỉnh hướng vận hành.' },
      normal: { ko: '금일 매출 현황을 정리하여 공유해 주세요.', vi: 'Vui lòng tổng hợp và chia sẻ tình hình doanh thu hôm nay.' },
      strong: { ko: '금일 매출 현황을 빠짐없이 정리하여 반드시 공유해 주세요.', vi: 'Bắt buộc tổng hợp đầy đủ và chia sẻ tình hình doanh thu hôm nay.' }
    }
  },
  equipment: {
    name: '장비 상태 점검',
    deadlineDefault: true,
    tones: {
      soft: { ko: '사용 중인 장비의 상태를 확인해 주세요. 이상이 있으면 빠르게 공유 부탁드립니다.', vi: 'Vui lòng kiểm tra tình trạng các thiết bị đang sử dụng. Nếu có bất thường, mong bạn báo lại sớm.' },
      normal: { ko: '사용 중인 장비의 상태를 점검하고 이상 여부를 보고해 주세요.', vi: 'Vui lòng kiểm tra tình trạng các thiết bị đang sử dụng và báo cáo nếu có bất thường.' },
      strong: { ko: '사용 중인 장비의 상태를 반드시 점검하고 이상 여부를 즉시 보고해 주세요.', vi: 'Bắt buộc kiểm tra tình trạng các thiết bị đang sử dụng và báo cáo ngay nếu có bất thường.' }
    }
  },
  service: {
    name: '고객 응대 품질 개선',
    deadlineDefault: false,
    tones: {
      soft: { ko: '고객 응대 시 친절한 태도를 유지하고 서비스 품질 향상에 함께 노력해 주세요.', vi: 'Khi phục vụ khách hàng, mong mọi người giữ thái độ thân thiện và cùng cố gắng nâng cao chất lượng dịch vụ.' },
      normal: { ko: '고객 응대 시 친절한 태도를 유지하고 서비스 품질 향상에 노력해 주세요.', vi: 'Vui lòng giữ thái độ thân thiện khi phục vụ khách hàng và nỗ lực nâng cao chất lượng dịch vụ.' },
      strong: { ko: '고객 응대 시 친절한 태도를 반드시 유지해 주세요. 서비스 품질 저하가 발생하지 않도록 주의 바랍니다.', vi: 'Bắt buộc giữ thái độ thân thiện khi phục vụ khách hàng. Vui lòng chú ý để không làm giảm chất lượng dịch vụ.' }
    }
  },
  training: {
    name: '교육 참석 안내',
    deadlineDefault: false,
    tones: {
      soft: { ko: '예정된 교육 일정에 참석해 주세요. 업무에 필요한 내용이므로 적극적인 참여 부탁드립니다.', vi: 'Vui lòng tham gia buổi đào tạo đã được lên lịch. Đây là nội dung cần thiết cho công việc, mong mọi người tham gia tích cực.' },
      normal: { ko: '예정된 교육 일정에 반드시 참석해 주시기 바랍니다.', vi: 'Vui lòng tham gia đầy đủ buổi đào tạo đã được lên lịch.' },
      strong: { ko: '예정된 교육 일정에는 반드시 참석해야 합니다. 불참이 필요한 경우 사전에 공유해 주세요.', vi: 'Bắt buộc tham gia buổi đào tạo đã được lên lịch. Nếu cần vắng mặt, phải báo trước.' }
    }
  },
  vacation: {
    name: '휴가 신청 안내',
    deadlineDefault: false,
    tones: {
      soft: { ko: '휴가 신청은 최소 3일 전에 제출해 주세요. 일정 조율을 위해 미리 공유 부탁드립니다.', vi: 'Vui lòng nộp đơn xin nghỉ phép trước ít nhất 3 ngày. Mong bạn báo sớm để thuận tiện sắp xếp lịch làm việc.' },
      normal: { ko: '휴가 신청은 최소 3일 전에 제출해 주세요.', vi: 'Vui lòng nộp đơn xin nghỉ phép trước ít nhất 3 ngày.' },
      strong: { ko: '휴가 신청은 반드시 최소 3일 전에 제출해 주세요. 사전 신청 없이 휴가를 진행하지 않도록 주의 바랍니다.', vi: 'Bắt buộc nộp đơn xin nghỉ phép trước ít nhất 3 ngày. Vui lòng không tự ý nghỉ khi chưa đăng ký trước.' }
    }
  },
  cctv: {
    name: 'CCTV 확인 요청',
    deadlineDefault: true,
    tones: {
      soft: { ko: '매장 CCTV가 정상 작동하는지 확인해 주세요. 문제가 있으면 바로 공유 부탁드립니다.', vi: 'Vui lòng kiểm tra xem CCTV của cửa hàng có hoạt động bình thường không. Nếu có vấn đề, mong bạn báo lại ngay.' },
      normal: { ko: '매장 CCTV 정상 작동 여부를 확인해 주세요.', vi: 'Vui lòng kiểm tra tình trạng hoạt động của CCTV cửa hàng.' },
      strong: { ko: '매장 CCTV 정상 작동 여부를 반드시 확인해 주세요. 이상이 있으면 즉시 보고 바랍니다.', vi: 'Bắt buộc kiểm tra tình trạng hoạt động của CCTV cửa hàng. Nếu có bất thường, vui lòng báo cáo ngay.' }
    }
  },
  prevention: {
    name: '재발 방지 요청',
    deadlineDefault: false,
    tones: {
      soft: { ko: '최근 발생한 문제의 원인을 확인하고 재발 방지 대책을 함께 마련해 주세요.', vi: 'Vui lòng kiểm tra nguyên nhân của vấn đề vừa xảy ra và cùng đưa ra biện pháp để tránh lặp lại.' },
      normal: { ko: '최근 발생한 문제에 대해 원인을 확인하고 재발 방지 대책을 마련해 주세요.', vi: 'Vui lòng kiểm tra nguyên nhân của vấn đề vừa xảy ra và đưa ra biện pháp phòng tránh tái diễn.' },
      strong: { ko: '최근 발생한 문제의 원인을 반드시 확인하고 재발 방지 대책을 마련해 주세요. 같은 문제가 반복되지 않도록 주의 바랍니다.', vi: 'Bắt buộc kiểm tra nguyên nhân của vấn đề vừa xảy ra và đưa ra biện pháp phòng tránh tái diễn. Cần chú ý để không lặp lại vấn đề tương tự.' }
    }
  }
};

